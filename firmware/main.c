/*
 * VoxAssist - FRDM-RW612 Firmware Reference
 * Hardware: NXP FRDM-RW612 + INMP441 I2S Digital MEMS Microphone
 * Communication: Bluetooth LE (EdgeFast BT Stack) to Android Companion
 * Protocol: 3-Opcode BLE Framing:
 *   - 0x01: START (PTT Button Pressed -> Resets companion app buffer)
 *   - 0x02: DATA  (Streaming PCM audio or text chunks into buffer)
 *   - 0x03: END   (PTT Button Released -> Companion flushes buffer & dispatches to WhatsApp)
 */

#include "fsl_common.h"
#include "fsl_gpio.h"
#include "fsl_i2s.h"
#include "fsl_i2s_dma.h"
#include "fsl_dma.h"
#include "pin_mux.h"
#include "board.h"
#include "edgefast_bluetooth.h"

/*******************************************************************************
 * Definitions & GATT Architecture
 ******************************************************************************/
#define I2S_FLEXCOMM            FLEXCOMM3
#define I2S_BASE                ((I2S_Type *)I2S_FLEXCOMM)
#define I2S_SAMPLE_RATE         16000
#define I2S_WORD_WIDTH          16
#define AUDIO_CHUNK_SIZE        240 // Sub-MTU chunk size (fits 512B MTU easily)

/* GATT UUIDs matching Android Companion app */
#define SERVICE_UUID            0xFFF0
#define CHAR_AUDIO_CMD_UUID     0xFFF1

/* Protocol Framing Opcodes */
#define OPCODE_START            0x01 // PTT asserted
#define OPCODE_DATA             0x02 // Streaming audio chunk
#define OPCODE_END              0x03 // PTT released (flush buffer)

/* Tactile Push-to-Talk Button (Active LOW with internal pull-up) */
#define PTT_GPIO_PORT           0
#define PTT_GPIO_PIN            12

/* Audio Ping-Pong Buffers */
static uint8_t s_AudioBufferPing[AUDIO_CHUNK_SIZE];
static uint8_t s_AudioBufferPong[AUDIO_CHUNK_SIZE];
static volatile bool s_PttPressed = false;

/* BLE Packet Buffer (1-byte opcode + payload) */
static uint8_t s_BleTxBuffer[AUDIO_CHUNK_SIZE + 1];

/* eDMA Handles */
static dma_handle_t s_DmaRxHandle;
static i2s_dma_handle_t s_I2sDmaRxHandle;

/*******************************************************************************
 * Helper: Transmit BLE Notification to Companion App
 ******************************************************************************/
static void Ble_SendNotification(const uint8_t *data, uint16_t len)
{
    /* In actual EdgeFast BLE stack:
     * struct bt_conn *conn = ...;
     * bt_gatt_notify(conn, &audio_char_attr, data, len);
     */
}

/*******************************************************************************
 * I2S & DMA Callback (Fires every time active ping-pong buffer fills)
 ******************************************************************************/
static void I2S_RxCallback(I2S_Type *base, i2s_dma_handle_t *handle, status_t completionStatus, void *userData)
{
    if (s_PttPressed) {
        /* User is actively holding the Push-to-Talk button */
        uint8_t *activeBuffer = (uint8_t *)userData;
        
        /* Frame packet: [OPCODE_DATA (0x02), byte0, byte1, ...] */
        s_BleTxBuffer[0] = OPCODE_DATA;
        memcpy(&s_BleTxBuffer[1], activeBuffer, AUDIO_CHUNK_SIZE);

        /* Stream chunk to Android Companion app over BLE */
        Ble_SendNotification(s_BleTxBuffer, AUDIO_CHUNK_SIZE + 1);
    }
}

/*******************************************************************************
 * Tactile Button GPIO ISR (Push-to-Talk for Blind User)
 ******************************************************************************/
void GPIO_IRQHandler(void)
{
    /* Read pin state (Active LOW with pull-up) */
    uint32_t pinState = GPIO_PinRead(GPIO, PTT_GPIO_PORT, PTT_GPIO_PIN);
    
    if (pinState == 0) {
        /* Pressed: Begin audio capture and notify phone to reset buffer */
        s_PttPressed = true;
        uint8_t startPacket = OPCODE_START;
        Ble_SendNotification(&startPacket, 1);
        PRINTF("[PTT] Button Pressed -> START opcode (0x01) sent\r\n");
    } else {
        /* Released: Stop audio capture and notify phone to flush & send */
        s_PttPressed = false;
        uint8_t endPacket = OPCODE_END;
        Ble_SendNotification(&endPacket, 1);
        PRINTF("[PTT] Button Released -> END opcode (0x03) sent (Trigger WhatsApp)\r\n");
    }
    
    GPIO_GpioClearInterruptFlags(GPIO, PTT_GPIO_PORT, 1U << PTT_GPIO_PIN);
}

/*******************************************************************************
 * Initialize INMP441 Microphone via Flexcomm I2S
 ******************************************************************************/
void Init_INMP441_I2S(void)
{
    i2s_config_t i2sConfig;
    
    /* 1. Configure Flexcomm in I2S Master Receive Mode */
    I2S_RxGetDefaultConfig(&i2sConfig);
    i2sConfig.divider     = CLOCK_GetFlexCommClkFreq(3) / (I2S_SAMPLE_RATE * I2S_WORD_WIDTH * 2);
    i2sConfig.masterSlave = kI2S_MasterSlaveNormalMaster;
    i2sConfig.mode        = kI2S_ModeI2sClassic;
    i2sConfig.dataLength  = I2S_WORD_WIDTH;
    
    I2S_RxInit(I2S_BASE, &i2sConfig);
    
    /* 2. Configure eDMA channel for continuous I2S reception */
    DMA_Init(DMA0);
    DMA_EnableChannel(DMA0, 0);
    DMA_CreateHandle(&s_DmaRxHandle, DMA0, 0);
    
    I2S_DMAInit(I2S_BASE, &s_I2sDmaRxHandle, &s_DmaRxHandle, I2S_RxCallback, (void *)s_AudioBufferPing);
}

/*******************************************************************************
 * Main Application Entry
 ******************************************************************************/
int main(void)
{
    BOARD_InitBootPins();
    BOARD_InitBootClocks();
    BOARD_InitDebugConsole();

    PRINTF("====================================================\r\n");
    PRINTF(" VoxAssist: FRDM-RW612 + INMP441 Microcontroller   \r\n");
    PRINTF(" Assistive Voice-to-WhatsApp BLE Streaming Gateway  \r\n");
    PRINTF(" Protocol: 0x01 (START) | 0x02 (DATA) | 0x03 (END)  \r\n");
    PRINTF("====================================================\r\n");

    /* Initialize Peripherals */
    Init_INMP441_I2S();

    /* Initialize Bluetooth LE Stack and advertise service 0xFFF0 */
    // edgefast_bt_init();
    // edgefast_bt_start_advertising("FRDM-RW612-VOX");

    while (1) {
        __WFI(); /* Low power sleep until PTT button interrupt */
    }
}
