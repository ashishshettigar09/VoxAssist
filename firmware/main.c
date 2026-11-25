/*
 * ============================================================================
 * VoxAssist - NXP FRDM-MCXW71 Assistive Audio & BLE Companion Firmware
 * Target Microcontroller: NXP FRDM-MCXW71 (ARM Cortex-M33 @ 96 MHz, BLE 5.3)
 * Framework: MCUXpresso SDK with NXP Wireless BLE Host Stack
 * ============================================================================
 *
 * HARDWARE INTERFACES CONFIGURED:
 * 1. 3.5mm Female AUX Connector (Audio/Mic In & Push-to-Talk):
 *    - Tip (Audio Left/Mono In) -> PTA16 (ADC0 Channel 0 / Arduino A0)
 *    - Ring 1 (Audio Right In / Aux Detect) -> PTA21 (GPIO / Arduino D2 with pull-up)
 *    - Ring 2 (Ground) -> GND
 *    - Sleeve (Mic / PTT Button) -> PTB0 (GPIO / Arduino D4 with pull-up)
 *
 * 2. Speaker & Audio Output:
 *    - Speaker Audio Out -> PTB1 (Arduino D3) for melody/tone generation
 *    - Amplifier Mute/Shutdown -> PTB2 (Arduino D5)
 *    - Target: 8 Ohm, 1W - 2W micro-speaker
 *
 * 3. Bluetooth Low Energy (BLE 5.3):
 *    - Advertising Name: "FRDM-MCXW71-VOX"
 *    - Service: Wireless UART Service (UUID: 128-bit)
 *    - Char Audio/Command: Notify & Write Without Response
 * ============================================================================
 */

#include "app.h"
#include "app_conn.h"
#include "fsl_os_abstraction.h"
#include "fsl_common.h"
#include "fsl_gpio.h"
#include "fsl_port.h"
#include "fsl_lpadc.h"
#include "fsl_clock.h"
#include "board.h"
#include "pin_mux.h"
#include "clock_config.h"
#include "wireless_uart.h"
#include "FunctionLib.h"
#include "parity_kws_model.h"
#include "test_audio_vector.h"

#if defined(gAppLowpowerEnabled_d) && (gAppLowpowerEnabled_d > 0)
#include "PWR_Interface.h"
#endif

/*******************************************************************************
 * Hardware Pin Definitions for FRDM-MCXW71
 ******************************************************************************/
/* Female AUX Connector Pins */
#define AUX_ADC_BASE             ADC0
#define AUX_ADC_USER_CHANNEL     0U               /* ADC0_CH0 on PTA16 (Arduino A0) */
#define AUX_ADC_PORT             PORTA
#define AUX_ADC_PIN              16U

#define AUX_JACK_DETECT_PORT     PORTA            /* PTA21 (Arduino D2) */
#define AUX_JACK_DETECT_GPIO     GPIOA
#define AUX_JACK_DETECT_PIN      21U

#define AUX_PTT_BUTTON_PORT      PORTB            /* PTB0 (Arduino D4) */
#define AUX_PTT_BUTTON_GPIO      GPIOB
#define AUX_PTT_BUTTON_PIN       0U

/* Speaker & Audio Amplifier Pins */
#define SPK_AUDIO_PORT           PORTB            /* PTB1 (Arduino D3) */
#define SPK_AUDIO_GPIO           GPIOB
#define SPK_AUDIO_PIN            1U

#define SPK_AMP_MUTE_PORT        PORTB            /* PTB2 (Arduino D5) */
#define SPK_AMP_MUTE_GPIO        GPIOB
#define SPK_AMP_MUTE_PIN         2U

/*******************************************************************************
 * Audio & Voice Activity Detection (VAD) Configuration
 ******************************************************************************/
#define AUDIO_CHUNK_SAMPLES          60U              /* 60 samples = 120 bytes (16-bit PCM) */
#define AUDIO_CHUNK_BYTES            (AUDIO_CHUNK_SAMPLES * sizeof(int16_t))

/* Voice Activity Detection (VAD) & Low Power Hands-Free Tuning */
#define VAD_THRESHOLD_AMPLITUDE      1400             /* Acoustic amplitude threshold above DC center bias */
#define VAD_TRIGGER_CONSECUTIVE_CNT  2U               /* Consecutive samples above threshold to confirm voice */
#define VAD_SILENCE_TIMEOUT_CHUNKS   320U             /* ~1.2s silence threshold before auto-stop */
#define VAD_MIN_SPEECH_CHUNKS        35U              /* ~130ms minimum speech length before silence allowed */

/* Protocol Framing Opcodes */
#define OPCODE_START                 0x01U            /* Voice triggered / Audio capture start */
#define OPCODE_DATA                  0x02U            /* Audio/PCM data chunk */
#define OPCODE_END                   0x03U            /* Silence detected / Audio capture end */
#define OPCODE_NOTIF_ALERT           0x10U            /* Incoming WhatsApp notification */
#define OPCODE_READOUT_REPLY         0x20U            /* Reply text readout stream */

/*******************************************************************************
 * Global State
 ******************************************************************************/
static volatile bool s_voice_active = false;
static volatile bool s_aux_jack_inserted = false;
static uint16_t s_vad_trigger_counter = 0U;
static uint32_t s_silence_chunks = 0U;
static uint32_t s_total_speech_chunks = 0U;

/* Audio buffer & BLE transmission packet */
static int16_t s_audio_buf[AUDIO_CHUNK_SAMPLES];
static uint8_t s_ble_tx_packet[AUDIO_CHUNK_BYTES + 1]; /* [Opcode, PCM bytes...] */

/*******************************************************************************
 * Speaker Acoustic Melody Synthesizer
 ******************************************************************************/
void Speaker_Init(void)
{
    CLOCK_EnableClock(kCLOCK_PortB);

    /* Configure PTB1 (Audio Out) as GPIO */
    PORT_SetPinMux(SPK_AUDIO_PORT, SPK_AUDIO_PIN, kPORT_MuxAsGpio);
    gpio_pin_config_t audio_out_config = {
        kGPIO_DigitalOutput,
        0
    };
    GPIO_PinInit(SPK_AUDIO_GPIO, SPK_AUDIO_PIN, &audio_out_config);

    /* Configure PTB2 (Amp Mute) as GPIO */
    PORT_SetPinMux(SPK_AMP_MUTE_PORT, SPK_AMP_MUTE_PIN, kPORT_MuxAsGpio);
    gpio_pin_config_t mute_config = {
        kGPIO_DigitalOutput,
        0 /* Default 0 = Muted */
    };
    GPIO_PinInit(SPK_AMP_MUTE_GPIO, SPK_AMP_MUTE_PIN, &mute_config);
}

void Speaker_Tone(uint32_t frequency_hz, uint32_t duration_ms)
{
    if (frequency_hz == 0U || duration_ms == 0U)
    {
        GPIO_PortClear(SPK_AUDIO_GPIO, 1U << SPK_AUDIO_PIN);
        GPIO_PortClear(SPK_AMP_MUTE_GPIO, 1U << SPK_AMP_MUTE_PIN);
        return;
    }

    uint32_t half_period_us = 1000000U / (2U * frequency_hz);
    uint32_t cycles = (frequency_hz * duration_ms) / 1000U;
    uint32_t coreClk = CLOCK_GetFreq(kCLOCK_CoreSysClk);

    /* Unmute amplifier */
    GPIO_PortSet(SPK_AMP_MUTE_GPIO, 1U << SPK_AMP_MUTE_PIN);

    for (uint32_t i = 0; i < cycles; i++)
    {
        GPIO_PortSet(SPK_AUDIO_GPIO, 1U << SPK_AUDIO_PIN);
        SDK_DelayAtLeastUs(half_period_us, coreClk);
        GPIO_PortClear(SPK_AUDIO_GPIO, 1U << SPK_AUDIO_PIN);
        SDK_DelayAtLeastUs(half_period_us, coreClk);
    }

    /* Mute amplifier */
    GPIO_PortClear(SPK_AMP_MUTE_GPIO, 1U << SPK_AMP_MUTE_PIN);
}

void Speaker_PlayChime(uint8_t chime_type)
{
    uint32_t coreClk = CLOCK_GetFreq(kCLOCK_CoreSysClk);

    switch (chime_type)
    {
        case 1: /* Incoming WhatsApp Notification Chime (High double chime) */
            Speaker_Tone(880U, 120U);  /* A5 */
            SDK_DelayAtLeastUs(40000U, coreClk);
            Speaker_Tone(1320U, 180U); /* E6 */
            break;

        case 2: /* PTT Record Start Chime */
            Speaker_Tone(660U, 90U);
            SDK_DelayAtLeastUs(20000U, coreClk);
            Speaker_Tone(880U, 120U);
            break;

        case 3: /* Success / Readout Sent Chime (Melody: C5 -> E5 -> G5 -> C6) */
            Speaker_Tone(523U, 80U);  /* C5 */
            Speaker_Tone(659U, 80U);  /* E5 */
            Speaker_Tone(784U, 80U);  /* G5 */
            Speaker_Tone(1046U, 180U);/* C6 */
            break;

        default:
            break;
    }
}

/*******************************************************************************
 * AUX Connector ADC & Jack Detect Initialization
 ******************************************************************************/
static void Aux_Connector_Init(void)
{
    CLOCK_EnableClock(kCLOCK_PortA);
    CLOCK_EnableClock(kCLOCK_PortB);

    /* 1. Configure ADC0 for 3.5mm AUX Audio sampling (PTA16 / Arduino A0) */
    PORT_SetPinMux(AUX_ADC_PORT, AUX_ADC_PIN, kPORT_PinDisabledOrAnalog);

    lpadc_config_t lpadcConfig;
    LPADC_GetDefaultConfig(&lpadcConfig);
    lpadcConfig.enableInDozeMode = true;
    lpadcConfig.conversionAverageMode = kLPADC_ConversionAverage1;
    LPADC_Init(AUX_ADC_BASE, &lpadcConfig);

    lpadc_conv_command_config_t cmdConfig;
    LPADC_GetDefaultConvCommandConfig(&cmdConfig);
    cmdConfig.channelNumber = AUX_ADC_USER_CHANNEL;
    cmdConfig.sampleChannelMode = kLPADC_SampleChannelSingleEndSideA;
    LPADC_SetConvCommandConfig(AUX_ADC_BASE, 1U, &cmdConfig);

    lpadc_conv_trigger_config_t triggerConfig;
    LPADC_GetDefaultConvTriggerConfig(&triggerConfig);
    triggerConfig.targetCommandId = 1U;
    triggerConfig.enableHardwareTrigger = false;
    LPADC_SetConvTriggerConfig(AUX_ADC_BASE, 0U, &triggerConfig);

    /* 2. Configure AUX 3.5mm Jack Insertion Detect Pin (PTA21 / Arduino D2) with Pull-Up */
    const port_pin_config_t pullup_config = {
        (uint16_t)kPORT_PullUp,
        (uint16_t)kPORT_HighPullResistor,
        (uint16_t)kPORT_FastSlewRate,
        (uint16_t)kPORT_PassiveFilterDisable,
        (uint16_t)kPORT_OpenDrainDisable,
        (uint16_t)kPORT_LowDriveStrength,
        (uint16_t)kPORT_NormalDriveStrength,
        (uint16_t)kPORT_MuxAsGpio,
        (uint16_t)kPORT_UnlockRegister
    };
    PORT_SetPinConfig(AUX_JACK_DETECT_PORT, AUX_JACK_DETECT_PIN, &pullup_config);
    gpio_pin_config_t jack_input = { kGPIO_DigitalInput, 0 };
    GPIO_PinInit(AUX_JACK_DETECT_GPIO, AUX_JACK_DETECT_PIN, &jack_input);

    /* 3. Configure AUX Push-to-Talk Button (PTB0 / Arduino D4) with Pull-Up */
    PORT_SetPinConfig(AUX_PTT_BUTTON_PORT, AUX_PTT_BUTTON_PIN, &pullup_config);
    gpio_pin_config_t ptt_input = { kGPIO_DigitalInput, 0 };
    GPIO_PinInit(AUX_PTT_BUTTON_GPIO, AUX_PTT_BUTTON_PIN, &ptt_input);
}

static int32_t s_adc_baseline = 32768;

static int16_t Aux_SampleAudio(void)
{
    LPADC_DoSoftwareTrigger(AUX_ADC_BASE, 1U);
    lpadc_conv_result_t result;
    while (!LPADC_GetConvResult(AUX_ADC_BASE, &result, 0U))
    {
    }
    /* Dynamic DC bias baseline tracker (prevents false VAD triggers from resistor tolerance) */
    s_adc_baseline += (((int32_t)result.convValue - s_adc_baseline) >> 7);
    return (int16_t)((int32_t)result.convValue - s_adc_baseline);
}

/*******************************************************************************
 * VoxAssist Audio Sampling, Jack Detection & PTT Handling
 ******************************************************************************/
static void VoxAssist_Init(void)
{
    Speaker_Init();
    Aux_Connector_Init();

    /* Play startup chime */
    Speaker_PlayChime(3);

    /* Run on-device Keyword Spotting inference verification using test vector */
    float kws_conf = 0.0f;
    int kws_class = KWS_ClassifyAudio(g_test_audio_sample, &kws_conf);
    if (kws_class == KWS_CLASS_PARITY || kws_class == KWS_CLASS_HELLO_PARITY || kws_class == KWS_CLASS_HEY_PARITY)
    {
        /* Neural network successfully recognized the keyword "parity" on Cortex-M33! */
        Speaker_PlayChime(2);
    }
}

static bool VoxAssist_IsBusy(void)
{
    return s_voice_active || !BleApp_IsTxQueueEmpty();
}

static void VoxAssist_Process(void)
{
    /* 1. Check 3.5mm AUX Jack Insertion State (Active Low when inserted) */
    uint32_t jackPin = GPIO_PinRead(AUX_JACK_DETECT_GPIO, AUX_JACK_DETECT_PIN);
    bool jackInserted = (jackPin == 0U);
    if (jackInserted != s_aux_jack_inserted)
    {
        s_aux_jack_inserted = jackInserted;
        Speaker_PlayChime(jackInserted ? 2U : 1U);
    }

    /* 2. Optional physical button fallback (Active Low on PTB0) */
    uint32_t pttPin = GPIO_PinRead(AUX_PTT_BUTTON_GPIO, AUX_PTT_BUTTON_PIN);
    bool buttonTrigger = (pttPin == 0U);

    /* 3. Hands-Free Voice Activity Detection (VAD) Trigger */
    if (!s_voice_active)
    {
        /* Sample microphone to evaluate ambient acoustic energy */
        int16_t sample = Aux_SampleAudio();
        int32_t amp = (sample < 0) ? -(int32_t)sample : (int32_t)sample;

        if (amp > VAD_THRESHOLD_AMPLITUDE)
        {
            s_vad_trigger_counter++;
        }
        else
        {
            if (s_vad_trigger_counter > 0U)
            {
                s_vad_trigger_counter--;
            }
        }

        /* Voice confirmed or manual button press: Wake up and start streaming */
        if (s_vad_trigger_counter >= VAD_TRIGGER_CONSECUTIVE_CNT || buttonTrigger)
        {
            s_voice_active = true;
            s_vad_trigger_counter = 0U;
            s_silence_chunks = 0U;
            s_total_speech_chunks = 0U;

            Speaker_PlayChime(2U); /* Audible chime: Listening started */
            uint8_t op = OPCODE_START;
            BleApp_NotifyPacket(&op, 1U);
        }
    }
    else
    {
        /* 4. Active Listening: Stream 16 kHz audio chunks over BLE & detect end of speech */
        if (BleApp_IsConnected())
        {
            uint32_t coreClk = CLOCK_GetFreq(kCLOCK_CoreSysClk);
            int32_t chunk_max_amp = 0;

            for (uint16_t i = 0; i < AUDIO_CHUNK_SAMPLES; i++)
            {
                s_audio_buf[i] = Aux_SampleAudio();
                int32_t a = (s_audio_buf[i] < 0) ? -(int32_t)s_audio_buf[i] : (int32_t)s_audio_buf[i];
                if (a > chunk_max_amp)
                {
                    chunk_max_amp = a;
                }
                /* ~16 kHz sampling delay (62.5 us per sample) */
                SDK_DelayAtLeastUs(55U, coreClk);
            }

            s_total_speech_chunks++;

            /* Stream the audio chunk */
            s_ble_tx_packet[0] = OPCODE_DATA;
            FLib_MemCpy(&s_ble_tx_packet[1], (uint8_t *)s_audio_buf, AUDIO_CHUNK_BYTES);
            BleApp_NotifyPacket(s_ble_tx_packet, (uint16_t)(AUDIO_CHUNK_BYTES + 1U));

            /* Track voice vs silence within the chunk */
            if (chunk_max_amp > VAD_THRESHOLD_AMPLITUDE || buttonTrigger)
            {
                s_silence_chunks = 0U; /* Active speech in progress */
            }
            else
            {
                s_silence_chunks++;
            }

            /* Silence Timeout: Conclude speech automatically and return to sleep */
            if (s_total_speech_chunks >= VAD_MIN_SPEECH_CHUNKS &&
                s_silence_chunks >= VAD_SILENCE_TIMEOUT_CHUNKS)
            {
                s_voice_active = false;
                uint8_t op = OPCODE_END;
                BleApp_NotifyPacket(&op, 1U);
                Speaker_PlayChime(3U); /* Confirmation chime: Utterance sent */
            }
        }
        else
        {
            /* If BLE is disconnected, reset state back to idle */
            s_voice_active = false;
        }
    }
}

/*******************************************************************************
 * Main Entry Point
 ******************************************************************************/
int main(void)
{
    /* Init OSA: should be called before any other OSA API */
    OSA_Init();

    BOARD_InitHardware();

    /* Start Application services (timers, serial manager, low power, led, button, etc..) */
    APP_InitServices();

    /* Start BLE Platform related ressources such as clocks, Link layer and HCI transport to Link Layer */
    (void)APP_InitBle();

    /* Example of baremetal loop if user doesn't want to use OSA API */
#if (FSL_OSA_BM_TIMER_CONFIG != FSL_OSA_BM_TIMER_NONE)
    OSA_TimeInit();
#endif

    /* Start Host stack */
    BluetoothLEHost_AppInit();

    /* Initialize VoxAssist Hardware (Speaker, AUX Jack, ADC, PTT) */
    VoxAssist_Init();

    while(TRUE)
    {
        OSA_ProcessTasks();
        BluetoothLEHost_HandleMessages();

        /* Connectivity background tasks (usually done in Idle thread) */
        BluetoothLEHost_ProcessIdleTask();

        /* Process VoxAssist audio sampling, jack insertion, and VAD */
        VoxAssist_Process();

        /* Drain stored audio packets from board buffer to mobile over BLE without loss */
        BleApp_ProcessTxQueue();

        OSA_DisableIRQGlobal();

        /* Check if some connectivity tasks have turned to ready state from interrupts */
        if (( OSA_TaskShouldYield() == FALSE ) && ( BluetoothLEHost_IsMessagePending() == FALSE ) && (BluetoothLEHost_IsConnectivityTaskToProcess() == FALSE))
        {
#if defined(gAppLowpowerEnabled_d) && (gAppLowpowerEnabled_d > 0)
            (void)PWR_EnterLowPower(0U);
#else
            if (!VoxAssist_IsBusy())
            {
                __WFI();
            }
#endif
        }

        OSA_EnableIRQGlobal();
    }

    /* Won't run here */
    assert(0);
    return 0;
}
