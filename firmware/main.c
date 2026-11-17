/*
 * ============================================================================
 * VoxAssist - NXP FRDM-MCXW71 Assistive Audio & BLE Companion Firmware
 * Target Microcontroller: NXP FRDM-MCXW71 (ARM Cortex-M33 @ 96 MHz, BLE 5.3)
 * Framework: MCUXpresso SDK with NXP Wireless EdgeFast BLE Host Stack
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
 *    - Speaker Audio Out -> PTB1 (CTIMER0 PWM / Arduino D3) into PAM8403 / MAX98357A amp
 *    - Amplifier Mute/Shutdown -> PTB2 (GPIO / Arduino D5)
 *    - Target: 8 Ohm, 1W - 2W micro-speaker
 *
 * 3. Bluetooth Low Energy (BLE 5.3):
 *    - Advertising Name: "FRDM-MCXW71-VOX"
 *    - Service UUID: 0x0000FFF0-0000-1000-8000-00805F9B34FB
 *    - Char Audio/Command TX: 0x0000FFF1-0000-1000-8000-00805F9B34FB (Notify)
 *    - Char Audio/Command RX: 0x0000FFF2-0000-1000-8000-00805F9B34FB (Write/Write Without Resp)
 *    - Char Status/Config:    0x0000FFF3-0000-1000-8000-00805F9B34FB (Read/Notify)
 * ============================================================================
 */

#include <stdio.h>
#include <string.h>
#include <stdbool.h>

/* NXP MCXW71 SDK Drivers */
#include "fsl_common.h"
#include "fsl_gpio.h"
#include "fsl_port.h"
#include "fsl_lpadc.h"
#include "fsl_edma.h"
#include "fsl_ctimer.h"
#include "fsl_debug_console.h"
#include "pin_mux.h"
#include "clock_config.h"
#include "board.h"

/* EdgeFast Bluetooth Stack */
#include "edgefast_bluetooth.h"
#include <bluetooth/bluetooth.h>
#include <bluetooth/conn.h>
#include <bluetooth/gatt.h>
#include <bluetooth/uuid.h>

/*******************************************************************************
 * Pin Assignments for FRDM-MCXW71
 ******************************************************************************/
/* Female AUX Connector Pins */
#define AUX_ADC_BASE             ADC0
#define AUX_ADC_USER_CHANNEL     0U               /* ADC0_CH0 on PTA16 (Arduino A0) */
#define AUX_ADC_PORT             GPIOA
#define AUX_ADC_PIN              16U

#define AUX_JACK_DETECT_PORT     GPIOA            /* PTA21 (Arduino D2) */
#define AUX_JACK_DETECT_PIN      21U
#define AUX_JACK_DETECT_IRQ      GPIOA_INT0_IRQn

#define AUX_PTT_BUTTON_PORT      GPIOB            /* PTB0 (Arduino D4) */
#define AUX_PTT_BUTTON_PIN       0U
#define AUX_PTT_BUTTON_IRQ       GPIOB_INT0_IRQn

/* Speaker & Audio Amplifier Pins */
#define SPK_PWM_CTIMER           CTIMER0          /* CTIMER0 PWM on PTB1 (Arduino D3) */
#define SPK_PWM_PERIOD_CH        kCTIMER_Match_0
#define SPK_PWM_OUT_CH           kCTIMER_Match_1
#define SPK_PWM_PORT             GPIOB
#define SPK_PWM_PIN              1U

#define SPK_AMP_MUTE_PORT        GPIOB            /* PTB2 (Arduino D5) */
#define SPK_AMP_MUTE_PIN         2U

/* Status RGB LED Pins */
#define LED_BLE_PORT             GPIOA
#define LED_BLE_PIN              4U               /* Blue LED on PTA4 */

/*******************************************************************************
 * Audio & Protocol Framing Configuration
 ******************************************************************************/
#define AUDIO_SAMPLE_RATE_HZ     16000U           /* 16 kHz voice sampling */
#define AUDIO_CHUNK_SAMPLES      120U             /* 120 samples = 240 bytes (16-bit) */
#define AUDIO_CHUNK_BYTES        (AUDIO_CHUNK_SAMPLES * sizeof(int16_t))
#define BLE_MAX_PAYLOAD_SIZE     244U             /* Fits in standard 247/512 BLE MTU */

/* Protocol Framing Opcodes */
#define OPCODE_START             0x01U            /* PTT pressed / Audio capture start */
#define OPCODE_DATA              0x02U            /* Audio/PCM data chunk */
#define OPCODE_END               0x03U            /* PTT released / Audio capture end */
#define OPCODE_NOTIF_ALERT       0x10U            /* Incoming WhatsApp notification: "New message from <contact>" */
#define OPCODE_READOUT_REPLY     0x20U            /* Reply text readout stream */
#define OPCODE_STATUS_QUERY      0x30U            /* Hardware status & jack detect */

/*******************************************************************************
 * GATT Service & Characteristic UUID Definitions
 ******************************************************************************/
/* Custom 128-bit VoxAssist Service: 0000FFF0-0000-1000-8000-00805F9B34FB */
#define BT_UUID_VOX_SERVICE_VAL \
    BT_UUID_128_ENCODE(0x0000FFF0, 0x0000, 0x1000, 0x8000, 0x00805F9B34FB)
#define BT_UUID_VOX_AUDIO_TX_VAL \
    BT_UUID_128_ENCODE(0x0000FFF1, 0x0000, 0x1000, 0x8000, 0x00805F9B34FB)
#define BT_UUID_VOX_AUDIO_RX_VAL \
    BT_UUID_128_ENCODE(0x0000FFF2, 0x0000, 0x1000, 0x8000, 0x00805F9B34FB)
#define BT_UUID_VOX_STATUS_VAL \
    BT_UUID_128_ENCODE(0x0000FFF3, 0x0000, 0x1000, 0x8000, 0x00805F9B34FB)

static struct bt_uuid_128 vox_service_uuid = BT_UUID_INIT_128(BT_UUID_VOX_SERVICE_VAL);
static struct bt_uuid_128 vox_audio_tx_uuid = BT_UUID_INIT_128(BT_UUID_VOX_AUDIO_TX_VAL);
static struct bt_uuid_128 vox_audio_rx_uuid = BT_UUID_INIT_128(BT_UUID_VOX_AUDIO_RX_VAL);
static struct bt_uuid_128 vox_status_uuid = BT_UUID_INIT_128(BT_UUID_VOX_STATUS_VAL);

/*******************************************************************************
 * Global State
 ******************************************************************************/
static struct bt_conn *s_current_conn = NULL;
static bool s_ble_connected = false;
static bool s_ptt_active = false;
static bool s_aux_jack_inserted = false;

/* Ping-Pong Audio Buffers sampled from AUX ADC */
static int16_t s_audio_ping[AUDIO_CHUNK_SAMPLES];
static int16_t s_audio_pong[AUDIO_CHUNK_SAMPLES];
static volatile uint8_t s_active_buf_idx = 0;
static uint8_t s_ble_tx_packet[AUDIO_CHUNK_BYTES + 1]; /* [Opcode, Data...] */

/* Notification & Speaker Buffer */
static char s_speaker_text_buf[256];

/*******************************************************************************
 * Speaker Audio Synthesizer (CTIMER PWM Tone Generator)
 ******************************************************************************/
static void Speaker_Init(void)
{
    /* Configure Amplifier Mute pin as Output (Default: High = Unmuted, Low = Muted) */
    gpio_pin_config_t mute_config = {
        kGPIO_DigitalOutput,
        1 /* Active High = Unmute */
    };
    GPIO_PinInit(SPK_AMP_MUTE_PORT, SPK_AMP_MUTE_PIN, &mute_config);

    /* Initialize CTIMER0 for PWM tone generation */
    ctimer_config_t ctimerConfig;
    CTIMER_GetDefaultConfig(&ctimerConfig);
    CTIMER_Init(SPK_PWM_CTIMER, &ctimerConfig);

    PRINTF("[SPEAKER] Audio PWM initialized on PTB1 (Arduino D3), Amp Mute on PTB2\r\n");
}

static void Speaker_SetFrequency(uint32_t frequency_hz, uint32_t duty_cycle_percent)
{
    if (frequency_hz == 0) {
        CTIMER_StopTimer(SPK_PWM_CTIMER);
        GPIO_PinWrite(SPK_AMP_MUTE_PORT, SPK_AMP_MUTE_PIN, 0); /* Mute amp */
        return;
    }

    GPIO_PinWrite(SPK_AMP_MUTE_PORT, SPK_AMP_MUTE_PIN, 1); /* Unmute amp */

    uint32_t timer_clock = CLOCK_GetFreq(kCLOCK_FroHf); /* High-speed FRO */
    uint32_t period = timer_clock / frequency_hz;
    uint32_t high_period = (period * duty_cycle_percent) / 100;

    ctimer_match_config_t matchConfig0;
    matchConfig0.enableCounterReset = true;
    matchConfig0.enableCounterStop = false;
    matchConfig0.matchValue = period;
    matchConfig0.outControl = kCTIMER_Output_NoAction;
    matchConfig0.outPinInitState = false;
    matchConfig0.enableInterrupt = false;

    ctimer_match_config_t matchConfig1;
    matchConfig1.enableCounterReset = false;
    matchConfig1.enableCounterStop = false;
    matchConfig1.matchValue = high_period;
    matchConfig1.outControl = kCTIMER_Output_Toggle;
    matchConfig1.outPinInitState = false;
    matchConfig1.enableInterrupt = false;

    CTIMER_SetupMatch(SPK_PWM_CTIMER, SPK_PWM_PERIOD_CH, &matchConfig0);
    CTIMER_SetupMatch(SPK_PWM_CTIMER, SPK_PWM_OUT_CH, &matchConfig1);
    CTIMER_StartTimer(SPK_PWM_CTIMER);
}

/* Play acoustic feedback melody for blind user */
static void Speaker_PlayChime(uint8_t chime_type)
{
    switch (chime_type) {
        case 1: /* Incoming WhatsApp Notification Chime (High double chime) */
            Speaker_SetFrequency(880, 50);  /* A5 */
            SDK_DelayAtLeastUs(120000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(0, 0);
            SDK_DelayAtLeastUs(40000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(1320, 50); /* E6 */
            SDK_DelayAtLeastUs(180000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(0, 0);
            break;

        case 2: /* PTT Record Start Chime */
            Speaker_SetFrequency(660, 40);
            SDK_DelayAtLeastUs(90000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(880, 40);
            SDK_DelayAtLeastUs(120000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(0, 0);
            break;

        case 3: /* Success / Sent Chime */
            Speaker_SetFrequency(523, 50); /* C5 */
            SDK_DelayAtLeastUs(80000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(659, 50); /* E5 */
            SDK_DelayAtLeastUs(80000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(784, 50); /* G5 */
            SDK_DelayAtLeastUs(80000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(1046, 50); /* C6 */
            SDK_DelayAtLeastUs(180000, CLOCK_GetFreq(kCLOCK_CoreSysClk));
            Speaker_SetFrequency(0, 0);
            break;

        default:
            Speaker_SetFrequency(0, 0);
            break;
    }
}

/*******************************************************************************
 * AUX Connector ADC & Jack Detect Initialization
 ******************************************************************************/
static void Aux_Connector_Init(void)
{
    /* 1. Configure ADC0 for 3.5mm AUX Audio sampling (PTA16 / Arduino A0) */
    lpadc_config_t lpadcConfig;
    LPADC_GetDefaultConfig(&lpadcConfig);
    lpadcConfig.enableInDozeMode = true;
    lpadcConfig.conversionAverageMode = kLPADC_ConversionAverage1;
    LPADC_Init(AUX_ADC_BASE, &lpadcConfig);

    /* Configure ADC Command */
    lpadc_conv_command_config_t cmdConfig;
    LPADC_GetDefaultConvCommandConfig(&cmdConfig);
    cmdConfig.channelNumber = AUX_ADC_USER_CHANNEL;
    cmdConfig.sampleScaleMode = kLPADC_SampleScaleFullRange;
    cmdConfig.sampleChannelMode = kLPADC_SampleChannelSingleEndSideA;
    LPADC_SetConvCommandConfig(AUX_ADC_BASE, 1U, &cmdConfig);

    /* Configure ADC Trigger */
    lpadc_conv_trigger_config_t triggerConfig;
    LPADC_GetDefaultConvTriggerConfig(&triggerConfig);
    triggerConfig.targetCommandId = 1U;
    triggerConfig.enableHardwareTrigger = false;
    LPADC_SetConvTriggerConfig(AUX_ADC_BASE, 0U, &triggerConfig);

    /* 2. Configure AUX 3.5mm Jack Insertion Detect Pin (PTA21 / Arduino D2) */
    gpio_pin_config_t jack_detect_config = {
        kGPIO_DigitalInput,
        0
    };
    GPIO_PinInit(AUX_JACK_DETECT_PORT, AUX_JACK_DETECT_PIN, &jack_detect_config);

    /* 3. Configure AUX Push-to-Talk Button (PTB0 / Arduino D4) */
    gpio_pin_config_t ptt_config = {
        kGPIO_DigitalInput,
        0
    };
    GPIO_PinInit(AUX_PTT_BUTTON_PORT, AUX_PTT_BUTTON_PIN, &ptt_config);

    PRINTF("[AUX] Female 3.5mm connector initialized: ADC on PTA16, Jack Detect on PTA21, PTT on PTB0\r\n");
}

/* Reads a single 16-bit audio sample from AUX ADC */
static int16_t Aux_SampleAudio(void)
{
    LPADC_DoSoftwareTrigger(AUX_ADC_BASE, 1U);
    lpadc_conv_result_t result;
    while (!LPADC_GetConvResult(AUX_ADC_BASE, &result, 0U)) {
        /* Wait for conversion */
    }
    /* LPADC returns 16-bit unsigned (0..65535), center at zero for signed PCM */
    return (int16_t)((int32_t)result.convValue - 32768);
}

/*******************************************************************************
 * BLE Notification Helpers
 ******************************************************************************/
static void Ble_NotifyAudioPacket(const uint8_t *data, uint16_t len)
{
    if (!s_ble_connected || !s_current_conn) return;

    /* In EdgeFast BLE stack: notify characteristic at index */
    bt_gatt_notify(s_current_conn, NULL, data, len);
}

static void Ble_SendOpcode(uint8_t opcode)
{
    uint8_t pkt = opcode;
    Ble_NotifyAudioPacket(&pkt, 1);
    PRINTF("[BLE TX] Opcode sent: 0x%02X\r\n", opcode);
}

/*******************************************************************************
 * GATT Characteristic Callbacks
 ******************************************************************************/
/* Mobile -> FRDM-MCXW71 Speaker Audio & Command Receiver */
static ssize_t on_audio_rx_write(struct bt_conn *conn,
                                 const struct bt_gatt_attr *attr,
                                 const void *buf,
                                 uint16_t len,
                                 uint16_t offset,
                                 uint8_t flags)
{
    if (len == 0) return 0;

    const uint8_t *data = (const uint8_t *)buf;
    uint8_t opcode = data[0];

    switch (opcode) {
        case OPCODE_NOTIF_ALERT: {
            /* WhatsApp Notification Arrived: "New message from <Contact>" */
            uint16_t textLen = len - 1;
            if (textLen >= sizeof(s_speaker_text_buf)) {
                textLen = sizeof(s_speaker_text_buf) - 1;
            }
            memcpy(s_speaker_text_buf, &data[1], textLen);
            s_speaker_text_buf[textLen] = '\0';

            PRINTF("\r\n========================================\r\n");
            PRINTF("[SPEAKER NOTIFICATION ALERT]\r\n");
            PRINTF("Incoming Announcement: %s\r\n", s_speaker_text_buf);
            PRINTF("========================================\r\n");

            /* Play double acoustic chime through speaker on board */
            Speaker_PlayChime(1);
            break;
        }

        case OPCODE_READOUT_REPLY: {
            /* User asked: "Read out" or "What is the reply" */
            uint16_t textLen = len - 1;
            if (textLen >= sizeof(s_speaker_text_buf)) {
                textLen = sizeof(s_speaker_text_buf) - 1;
            }
            memcpy(s_speaker_text_buf, &data[1], textLen);
            s_speaker_text_buf[textLen] = '\0';

            PRINTF("\r\n[SPEAKER READOUT] WhatsApp Reply Body:\r\n");
            PRINTF("\"%s\"\r\n", s_speaker_text_buf);

            /* Play success chime then announce text */
            Speaker_PlayChime(3);
            break;
        }

        default:
            PRINTF("[BLE RX] Unknown command opcode 0x%02X\r\n", opcode);
            break;
    }

    return len;
}

/*******************************************************************************
 * GATT Services Table
 ******************************************************************************/
static struct bt_gatt_attr vox_service_attrs[] = {
    /* Primary Service Declaration */
    BT_GATT_PRIMARY_SERVICE(&vox_service_uuid),

    /* Audio/Command TX Characteristic (Notify) */
    BT_GATT_CHARACTERISTIC(&vox_audio_tx_uuid.uuid,
                           BT_GATT_CHRC_NOTIFY,
                           BT_GATT_PERM_NONE,
                           NULL, NULL, NULL),
    BT_GATT_CCC(NULL, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),

    /* Audio/Command RX Characteristic (Write / Write Without Response) */
    BT_GATT_CHARACTERISTIC(&vox_audio_rx_uuid.uuid,
                           BT_GATT_CHRC_WRITE | BT_GATT_CHRC_WRITE_WITHOUT_RESP,
                           BT_GATT_PERM_WRITE,
                           NULL, on_audio_rx_write, NULL),

    /* Status Characteristic (Read) */
    BT_GATT_CHARACTERISTIC(&vox_status_uuid.uuid,
                           BT_GATT_CHRC_READ | BT_GATT_CHRC_NOTIFY,
                           BT_GATT_PERM_READ,
                           NULL, NULL, NULL),
};

static struct bt_gatt_service vox_service = BT_GATT_SERVICE(vox_service_attrs);

/*******************************************************************************
 * BLE Connection Callbacks
 ******************************************************************************/
static void on_ble_connected(struct bt_conn *conn, uint8_t err)
{
    if (err) {
        PRINTF("[BLE] Connection failed (error %u)\r\n", err);
        return;
    }

    s_current_conn = bt_conn_ref(conn);
    s_ble_connected = true;
    PRINTF("[BLE] Successfully connected to Mobile App!\r\n");

    /* Turn on Blue BLE Status LED */
    GPIO_PinWrite(LED_BLE_PORT, LED_BLE_PIN, 1);

    /* Play connect confirmation tone */
    Speaker_PlayChime(3);
}

static void on_ble_disconnected(struct bt_conn *conn, uint8_t reason)
{
    PRINTF("[BLE] Disconnected (reason %u). Restarting advertising...\r\n", reason);

    if (s_current_conn) {
        bt_conn_unref(s_current_conn);
        s_current_conn = NULL;
    }
    s_ble_connected = false;

    /* Turn off BLE LED */
    GPIO_PinWrite(LED_BLE_PORT, LED_BLE_PIN, 0);

    /* Automatically resume advertising as FRDM-MCXW71-VOX */
    bt_le_adv_start(BT_LE_ADV_CONN, NULL, 0, NULL, 0);
}

static struct bt_conn_cb conn_callbacks = {
    .connected = on_ble_connected,
    .disconnected = on_ble_disconnected,
};

/*******************************************************************************
 * BLE Advertising Setup
 ******************************************************************************/
static const struct bt_data adv_data[] = {
    BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
    BT_DATA(BT_DATA_NAME_COMPLETE, "FRDM-MCXW71-VOX", 15),
    BT_DATA_BYTES(BT_DATA_UUID16_ALL, 0xF0, 0xFF), /* 0xFFF0 VoxAssist Service */
};

static void Ble_StartAdvertising(void)
{
    int err = bt_le_adv_start(BT_LE_ADV_CONN, adv_data, ARRAY_SIZE(adv_data), NULL, 0);
    if (err) {
        PRINTF("[BLE] Advertising failed to start (err %d)\r\n", err);
    } else {
        PRINTF("[BLE] Advertising active as \"FRDM-MCXW71-VOX\" (Service 0xFFF0)\r\n");
    }
}

/*******************************************************************************
 * Main Audio Capture & Background Processing Loop
 ******************************************************************************/
static void Process_Audio_And_Buttons(void)
{
    /* 1. Check 3.5mm AUX Jack Insertion State */
    uint32_t jackPin = GPIO_PinRead(AUX_JACK_DETECT_PORT, AUX_JACK_DETECT_PIN);
    bool jackInserted = (jackPin == 0); /* Active Low when 3.5mm plug inserted */
    if (jackInserted != s_aux_jack_inserted) {
        s_aux_jack_inserted = jackInserted;
        PRINTF("[AUX] Jack insertion state changed: %s\r\n", 
               s_aux_jack_inserted ? "PLUGGED IN" : "UNPLUGGED");
        Speaker_PlayChime(jackInserted ? 2 : 1);
    }

    /* 2. Check Push-to-Talk Button State (PTB0 or AUX inline mic button) */
    uint32_t pttPin = GPIO_PinRead(AUX_PTT_BUTTON_PORT, AUX_PTT_BUTTON_PIN);
    bool pttNow = (pttPin == 0); /* Active LOW with internal pull-up */

    /* PTT Press Transition -> START */
    if (pttNow && !s_ptt_active) {
        s_ptt_active = true;
        PRINTF("[PTT] Button Pressed -> START recording\r\n");
        Speaker_PlayChime(2); /* Play start beep */
        Ble_SendOpcode(OPCODE_START);
    }
    /* PTT Release Transition -> END */
    else if (!pttNow && s_ptt_active) {
        s_ptt_active = false;
        PRINTF("[PTT] Button Released -> END recording & flush buffer\r\n");
        Ble_SendOpcode(OPCODE_END);
        Speaker_PlayChime(3); /* Play confirmation tone */
    }

    /* 3. If PTT is held, sample audio from AUX ADC and stream over BLE */
    if (s_ptt_active && s_ble_connected) {
        int16_t *buf = (s_active_buf_idx == 0) ? s_audio_ping : s_audio_pong;

        /* Sample a chunk of audio from AUX ADC */
        for (uint16_t i = 0; i < AUDIO_CHUNK_SAMPLES; i++) {
            buf[i] = Aux_SampleAudio();
            /* 16kHz sampling delay: ~62.5us per sample */
            SDK_DelayAtLeastUs(58, CLOCK_GetFreq(kCLOCK_CoreSysClk));
        }

        /* Frame BLE packet: [OPCODE_DATA, sample0_L, sample0_H, sample1_L...] */
        s_ble_tx_packet[0] = OPCODE_DATA;
        memcpy(&s_ble_tx_packet[1], buf, AUDIO_CHUNK_BYTES);

        /* Send chunk to Mobile App over BLE */
        Ble_NotifyAudioPacket(s_ble_tx_packet, AUDIO_CHUNK_BYTES + 1);

        /* Toggle ping-pong index */
        s_active_buf_idx ^= 1;
    }
}

/*******************************************************************************
 * Main Entry Point
 ******************************************************************************/
int main(void)
{
    /* Initialize NXP Board Clocks and Pins */
    BOARD_InitPins();
    BOARD_BootClockRUN();
    BOARD_InitDebugConsole();

    PRINTF("\r\n======================================================\r\n");
    PRINTF("  VoxAssist - FRDM-MCXW71 BLE Voice Gateway Firmware\r\n");
    PRINTF("  Target MCU: NXP MCX W71 (ARM Cortex-M33 @ 96 MHz)\r\n");
    PRINTF("  Auxiliary: 3.5mm Female AUX Mic In + Speaker Audio\r\n");
    PRINTF("======================================================\r\n");

    /* Initialize Speaker Subsystem */
    Speaker_Init();

    /* Initialize Female AUX Connector Subsystem */
    Aux_Connector_Init();

    /* Initialize Bluetooth Low Energy Stack */
    int err = bt_enable(NULL);
    if (err) {
        PRINTF("[BLE] Stack init failed with error: %d\r\n", err);
        return 0;
    }
    PRINTF("[BLE] EdgeFast Bluetooth Stack initialized successfully.\r\n");

    /* Register Connection Callbacks and Custom GATT Services */
    bt_conn_cb_register(&conn_callbacks);
    bt_gatt_service_register(&vox_service);

    /* Begin BLE Advertising */
    Ble_StartAdvertising();

    /* Play startup chime */
    Speaker_PlayChime(3);

    /* Main Superloop */
    while (1) {
        /* Process BLE stack events */
        /* Process AUX audio sampling and button triggers */
        Process_Audio_And_Buttons();
    }
}
