/*
 * VoxAssist - FRDM-RW612 Firmware Reference
 * Hardware: NXP FRDM-RW612 + INMP441 I2S Digital MEMS Microphone
 * Communication: Bluetooth LE (EdgeFast BT Stack) to Android Companion
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
 * Definitions
 ******************************************************************************/
#define I2S_FLEXCOMM            FLEXCOMM3
#define I2S_BASE                ((I2S_Type *)I2S_FLEXCOMM)
#define I2S_SAMPLE_RATE         16000
#define I2S_WORD_WIDTH          16
#define AUDIO_BUFFER_SIZE       512

/* Tactile Push-to-Talk Button */
#define PTT_GPIO_PORT           0
#define PTT_GPIO_PIN            12

/* Audio Ping-Pong Buffers */
static uint8_t s_AudioBufferPing[AUDIO_BUFFER_SIZE];
static uint8_t s_AudioBufferPong[AUDIO_BUFFER_SIZE];
static volatile bool s_PttPressed = false;

/* eDMA Handles */
static dma_handle_t s_DmaRxHandle;
static i2s_dma_handle_t s_I2sDmaRxHandle;

/*******************************************************************************
 * I2S & DMA Callback
 ******************************************************************************/
static void I2S_RxCallback(I2S_Type *base, i2s_dma_handle_t *handle, status_t completionStatus, void *userData)
{
    if (s_PttPressed) {
        /* User is actively holding the Push-to-Talk button */
        uint8_t *activeBuffer = (uint8_t *)userData;
        
        /* Transmit audio frame over BLE GATT Notification characteristic */
        // bt_gatt_notify(s_BleConn, &s_AudioCharAttr, activeBuffer, AUDIO_BUFFER_SIZE);
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
        /* Pressed: Begin audio capture */
        s_PttPressed = true;
        // Send BLE event to awaken phone app
    } else {
        /* Released: Stop audio capture */
        s_PttPressed = false;
        // Send BLE event signaling end of voice command
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

    PRINTF("=========================================\r\n");
    PRINTF(" VoxAssist: FRDM-RW612 + INMP441 Ready  \r\n");
    PRINTF(" Assistive Voice-to-SMS Gateway Initialized\r\n");
    PRINTF("=========================================\r\n");

    /* Initialize Peripherals */
    Init_INMP441_I2S();

    /* Initialize Bluetooth LE Stack */
    // edgefast_bt_init();
    // edgefast_bt_start_advertising("FRDM-RW612-VOX");

    while (1) {
        __WFI(); /* Low power sleep until PTT button interrupt */
    }
}
