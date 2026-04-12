/*
 * Robotic Arm Controller - Windows C Application
 * Controls 6-DOF robotic arm via serial communication
 * 
 * Compile with: gcc -o robotic_arm_controller.exe robotic_arm_controller.c -lgdi32 -luser32 -lcomdlg32
 * Or use MinGW: gcc robotic_arm_controller.c -o robotic_arm_controller.exe -lgdi32 -luser32 -lcomdlg32
 */

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0501  // Windows XP or later
#endif
#ifndef _WIN32_IE
#define _WIN32_IE 0x0500  // Internet Explorer 5.0 or later (for common controls)
#endif
#include <windows.h>
#include <commctrl.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "comdlg32.lib")

#define NUM_SERVOS 6
#define WM_UPDATE_SERVO (WM_USER + 1)
#define TIMER_UPDATE 1
#define TIMER_THROTTLE 2

// Servo information
typedef struct {
    char name[32];
    int index;
    int angle;
    int lastSentAngle;  // Track last sent position for smooth movement
    HWND slider;
    HWND label;
    HWND value_label;
} ServoInfo;

// Global variables
HANDLE hSerial = INVALID_HANDLE_VALUE;
BOOL isConnected = FALSE;
char comPort[32] = "";
ServoInfo servos[NUM_SERVOS] = {
    {"Base", 1, 90, 90, NULL, NULL, NULL},
    {"Shoulder", 2, 90, 90, NULL, NULL, NULL},
    {"Elbow", 3, 90, 90, NULL, NULL, NULL},
    {"Wrist Rotation", 4, 90, 90, NULL, NULL, NULL},
    {"Wrist Pitch", 5, 90, 90, NULL, NULL, NULL},
    {"Gripper", 6, 90, 90, NULL, NULL, NULL}
};

HWND hwndMain;
HWND hComboBox;
HWND hConnectButton;
HWND hRefreshButton;
HWND hStatusLabel;
HWND hCommandEdit;
HWND hSendButton;
HWND hCenterButton;
HWND hSendAllButton;
HWND hSpeedSlider;
HWND hSpeedLabel;
HWND hSmoothCheckbox;
HWND hAngleStepEdit;
HWND hAngleStepLabel;

DWORD lastCommandTime = 0;
const DWORD COMMAND_THROTTLE_MS = 10;  // Reduced for more responsive updates
HBRUSH hStatusBrush = NULL;
COLORREF statusColor = RGB(200, 0, 0);  // Red by default

// Movement control
int movementSpeed = 50;  // 1-100, higher = faster
BOOL smoothMovement = TRUE;  // Enable smooth transitions
int angleStep = 1;  // Degrees per step for smooth movement

// Function prototypes
LRESULT CALLBACK WindowProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam);
BOOL InitApplication(HINSTANCE hInstance);
BOOL InitInstance(HINSTANCE hInstance, int nCmdShow);
void CreateControls(HWND hwnd);
void ScanPorts();
BOOL ConnectToArduino(const char* port);
void DisconnectArduino();
BOOL SendCommand(int servoIndex, int angle, BOOL force);
void SendCommandSmooth(int servoIndex, int targetAngle);
void UpdateServoDisplay(int servoIdx);
void CenterAllServos();
void SendAllServos();
void OnSliderChange(int servoIdx, int value);
void UpdateSpeedDisplay();

// Window procedure
LRESULT CALLBACK WindowProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
        case WM_CREATE:
            CreateControls(hwnd);
            ScanPorts();
            return 0;

        case WM_HSCROLL: {
            HWND hSlider = (HWND)lParam;
            
            // Handle speed slider
            if (hSlider == hSpeedSlider) {
                if (LOWORD(wParam) == TB_THUMBTRACK || LOWORD(wParam) == TB_ENDTRACK || LOWORD(wParam) == TB_LINEDOWN || LOWORD(wParam) == TB_LINEUP) {
                    movementSpeed = SendMessage(hSpeedSlider, TBM_GETPOS, 0, 0);
                    UpdateSpeedDisplay();
                }
                return 0;
            }
            
            // Handle servo sliders
            if (LOWORD(wParam) == TB_THUMBTRACK || LOWORD(wParam) == TB_ENDTRACK || LOWORD(wParam) == TB_LINEDOWN || LOWORD(wParam) == TB_LINEUP || LOWORD(wParam) == TB_PAGEDOWN || LOWORD(wParam) == TB_PAGEUP) {
                for (int i = 0; i < NUM_SERVOS; i++) {
                    if (servos[i].slider == hSlider) {
                        int value = SendMessage(hSlider, TBM_GETPOS, 0, 0);
                        servos[i].angle = value;
                        UpdateServoDisplay(i);
                        
                        // Send command if connected
                        if (isConnected) {
                            if (LOWORD(wParam) == TB_ENDTRACK) {
                                // Slider released - send final position with smooth movement if enabled
                                if (smoothMovement) {
                                    SendCommandSmooth(servos[i].index, value);
                                } else {
                                    SendCommand(servos[i].index, value, TRUE);
                                }
                            } else if (LOWORD(wParam) == TB_THUMBTRACK) {
                                // Slider being dragged - always send commands directly (smooth movement only on release)
                                SendCommand(servos[i].index, value, FALSE);
                            } else {
                                // Arrow keys or page up/down - send immediately
                                if (smoothMovement) {
                                    SendCommandSmooth(servos[i].index, value);
                                } else {
                                    SendCommand(servos[i].index, value, TRUE);
                                }
                            }
                        }
                        break;
                    }
                }
            }
            return 0;
        }

        case WM_COMMAND:
            if (HIWORD(wParam) == BN_CLICKED) {
                switch (LOWORD(wParam)) {
                    case 1001: // Connect button
                        if (isConnected) {
                            DisconnectArduino();
                        } else {
                            int sel = SendMessage(hComboBox, CB_GETCURSEL, 0, 0);
                            if (sel != CB_ERR) {
                                char port[32];
                                SendMessage(hComboBox, CB_GETLBTEXT, sel, (LPARAM)port);
                                ConnectToArduino(port);
                            } else {
                                MessageBox(hwnd, "Please select a COM port", "Error", MB_OK | MB_ICONERROR);
                            }
                        }
                        return 0;

                    case 1002: // Refresh button
                        ScanPorts();
                        return 0;

                    case 1003: // Center button
                        CenterAllServos();
                        return 0;

                    case 1004: // Send All button
                        SendAllServos();
                        return 0;

                    case 1007: // Smooth movement checkbox
                        smoothMovement = (SendMessage(hSmoothCheckbox, BM_GETCHECK, 0, 0) == BST_CHECKED);
                        return 0;

                    case 1005: // Send command button
                    case IDOK: // Also handle Enter key
                        {
                            char cmd[128];  // Increased for multiple commands
                            GetWindowText(hCommandEdit, cmd, sizeof(cmd));
                            if (strlen(cmd) > 0) {
                                // Check if multiple commands (comma-separated for synchronized movement)
                                if (strchr(cmd, ',') != NULL) {
                                    // Multiple servos - synchronized movement
                                    char cmdCopy[128];
                                    strcpy(cmdCopy, cmd);
                                    int servoIdx, angle;
                                    BOOL hasValidCommand = FALSE;
                                    
                                    // Parse comma-separated commands manually (portable)
                                    char* token = strtok(cmdCopy, ",");
                                    while (token != NULL) {
                                        // Skip whitespace
                                        while (*token == ' ') token++;
                                        
                                        if (sscanf(token, "%d:%d", &servoIdx, &angle) == 2) {
                                            if (servoIdx >= 1 && servoIdx <= 6) {
                                                int idx = servoIdx - 1;
                                                if (angle < 0) angle = 0;
                                                if (angle > 180) angle = 180;
                                                servos[idx].angle = angle;
                                                SendMessage(servos[idx].slider, TBM_SETPOS, TRUE, angle);
                                                UpdateServoDisplay(idx);
                                                hasValidCommand = TRUE;
                                            }
                                        }
                                        token = strtok(NULL, ",");
                                    }
                                    
                                    if (hasValidCommand && isConnected) {
                                        // Send synchronized command (comma-separated format)
                                        // This format is for the smooth motion firmware
                                        char syncCmd[128];
                                        strcpy(syncCmd, cmd);
                                        strcat(syncCmd, "\n");
                                        DWORD bytesWritten;
                                        if (hSerial != INVALID_HANDLE_VALUE) {
                                            if (WriteFile(hSerial, syncCmd, strlen(syncCmd), &bytesWritten, NULL)) {
                                                FlushFileBuffers(hSerial);
                                            }
                                        }
                                    }
                                    SetWindowText(hCommandEdit, "");
                                    SetFocus(hCommandEdit);
                                } else {
                                    // Single servo command
                                    int servoIdx, angle;
                                    if (sscanf(cmd, "%d:%d", &servoIdx, &angle) == 2) {
                                        if (servoIdx >= 1 && servoIdx <= 6) {
                                            int idx = servoIdx - 1;
                                            if (angle < 0) angle = 0;
                                            if (angle > 180) angle = 180;
                                            servos[idx].angle = angle;
                                            SendMessage(servos[idx].slider, TBM_SETPOS, TRUE, angle);
                                            UpdateServoDisplay(idx);
                                            if (isConnected) {
                                                if (smoothMovement) {
                                                    SendCommandSmooth(servoIdx, angle);
                                                } else {
                                                    SendCommand(servoIdx, angle, TRUE);
                                                }
                                            }
                                            SetWindowText(hCommandEdit, "");
                                            SetFocus(hCommandEdit);
                                        } else {
                                            MessageBox(hwnd, "Servo index must be 1-6", "Error", MB_OK | MB_ICONERROR);
                                        }
                                    } else {
                                        MessageBox(hwnd, "Invalid format. Use 'index:angle' or '1:90,2:120,3:45'", "Error", MB_OK | MB_ICONERROR);
                                    }
                                }
                            }
                        }
                        return 0;

                    case 1008: // Angle step edit
                        if (HIWORD(wParam) == EN_KILLFOCUS) {
                            char stepText[8];
                            GetWindowText(hAngleStepEdit, stepText, sizeof(stepText));
                            int step = atoi(stepText);
                            if (step < 1) step = 1;
                            if (step > 10) step = 10;
                            angleStep = step;
                            char stepStr[8];
                            sprintf(stepStr, "%d", step);
                            SetWindowText(hAngleStepEdit, stepStr);
                        }
                        return 0;
                }
            } else if (HIWORD(wParam) == EN_UPDATE && LOWORD(wParam) == 1006) {
                // Handle text change in command edit (optional)
                return 0;
            }
            return 0;

        case WM_CTLCOLORSTATIC:
            {
                HDC hdcStatic = (HDC)wParam;
                if ((HWND)lParam == hStatusLabel) {
                    SetTextColor(hdcStatic, statusColor);
                    SetBkColor(hdcStatic, GetSysColor(COLOR_WINDOW));
                    if (hStatusBrush) DeleteObject(hStatusBrush);
                    hStatusBrush = CreateSolidBrush(GetSysColor(COLOR_WINDOW));
                    return (LRESULT)hStatusBrush;
                }
            }
            return DefWindowProc(hwnd, uMsg, wParam, lParam);

        case WM_CLOSE:
            DisconnectArduino();
            DestroyWindow(hwnd);
            return 0;

        case WM_DESTROY:
            if (hStatusBrush) {
                DeleteObject(hStatusBrush);
                hStatusBrush = NULL;
            }
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProc(hwnd, uMsg, wParam, lParam);
}

// Create UI controls
void CreateControls(HWND hwnd) {
    // COM Port label and combo
    CreateWindow("STATIC", "COM Port:", WS_VISIBLE | WS_CHILD, 10, 10, 70, 20, hwnd, NULL, NULL, NULL);
    hComboBox = CreateWindow("COMBOBOX", "", WS_VISIBLE | WS_CHILD | CBS_DROPDOWNLIST | WS_VSCROLL, 90, 8, 150, 200, hwnd, (HMENU)1000, NULL, NULL);

    // Refresh button
    hRefreshButton = CreateWindow("BUTTON", "Refresh", WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON, 250, 8, 70, 25, hwnd, (HMENU)1002, NULL, NULL);

    // Connect button
    hConnectButton = CreateWindow("BUTTON", "Connect", WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON, 330, 8, 80, 25, hwnd, (HMENU)1001, NULL, NULL);

    // Status label
    hStatusLabel = CreateWindow("STATIC", "Disconnected", WS_VISIBLE | WS_CHILD | SS_LEFT, 10, 40, 400, 20, hwnd, NULL, NULL, NULL);

    // Servo sliders
    int yPos = 70;
    for (int i = 0; i < NUM_SERVOS; i++) {
        // Servo name and value
        char label[64];
        sprintf(label, "%s (Servo %d):", servos[i].name, servos[i].index);
        servos[i].label = CreateWindow("STATIC", label, WS_VISIBLE | WS_CHILD, 10, yPos, 150, 20, hwnd, NULL, NULL, NULL);
        
        sprintf(label, "%d°", servos[i].angle);
        servos[i].value_label = CreateWindow("STATIC", label, WS_VISIBLE | WS_CHILD | SS_RIGHT, 420, yPos, 50, 20, hwnd, NULL, NULL, NULL);

        // Slider - with fine control (1 degree increments)
        servos[i].slider = CreateWindow(TRACKBAR_CLASS, "", WS_VISIBLE | WS_CHILD | TBS_HORZ | TBS_AUTOTICKS, 170, yPos, 240, 30, hwnd, NULL, NULL, NULL);
        SendMessage(servos[i].slider, TBM_SETRANGE, TRUE, MAKELONG(0, 180));
        SendMessage(servos[i].slider, TBM_SETPOS, TRUE, 90);
        SendMessage(servos[i].slider, TBM_SETTICFREQ, 30, 0);
        SendMessage(servos[i].slider, TBM_SETLINESIZE, 0, 1);  // 1 degree per arrow key
        SendMessage(servos[i].slider, TBM_SETPAGESIZE, 0, 5);  // 5 degrees per page up/down

        yPos += 45;
    }

    // Control buttons
    hCenterButton = CreateWindow("BUTTON", "Center All (90°)", WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON, 10, yPos, 120, 30, hwnd, (HMENU)1003, NULL, NULL);
    hSendAllButton = CreateWindow("BUTTON", "Send All", WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON, 140, yPos, 100, 30, hwnd, (HMENU)1004, NULL, NULL);

    yPos += 45;

    // Speed control
    CreateWindow("STATIC", "Movement Speed:", WS_VISIBLE | WS_CHILD, 10, yPos, 100, 20, hwnd, NULL, NULL, NULL);
    hSpeedSlider = CreateWindow(TRACKBAR_CLASS, "", WS_VISIBLE | WS_CHILD | TBS_HORZ | TBS_AUTOTICKS, 120, yPos, 200, 30, hwnd, NULL, NULL, NULL);
    SendMessage(hSpeedSlider, TBM_SETRANGE, TRUE, MAKELONG(1, 100));
    SendMessage(hSpeedSlider, TBM_SETPOS, TRUE, movementSpeed);
    SendMessage(hSpeedSlider, TBM_SETTICFREQ, 20, 0);
    hSpeedLabel = CreateWindow("STATIC", "50%", WS_VISIBLE | WS_CHILD | SS_LEFT, 330, yPos, 50, 20, hwnd, NULL, NULL, NULL);

    yPos += 35;

    // Smooth movement checkbox
    hSmoothCheckbox = CreateWindow("BUTTON", "Smooth Movement", WS_VISIBLE | WS_CHILD | BS_AUTOCHECKBOX, 10, yPos, 150, 25, hwnd, (HMENU)1007, NULL, NULL);
    SendMessage(hSmoothCheckbox, BM_SETCHECK, BST_CHECKED, 0);  // Checked by default

    // Angle step control
    CreateWindow("STATIC", "Angle Step:", WS_VISIBLE | WS_CHILD, 170, yPos, 80, 20, hwnd, NULL, NULL, NULL);
    hAngleStepEdit = CreateWindow("EDIT", "1", WS_VISIBLE | WS_CHILD | WS_BORDER | ES_LEFT | ES_NUMBER, 255, yPos, 40, 25, hwnd, (HMENU)1008, NULL, NULL);
    SendMessage(hAngleStepEdit, EM_SETLIMITTEXT, 2, 0);
    CreateWindow("STATIC", "degrees", WS_VISIBLE | WS_CHILD, 300, yPos, 60, 20, hwnd, NULL, NULL, NULL);

    yPos += 40;

    // Manual command
    CreateWindow("STATIC", "Manual Command:", WS_VISIBLE | WS_CHILD, 10, yPos, 200, 20, hwnd, NULL, NULL, NULL);
    CreateWindow("STATIC", "(single: 1:90 or sync: 1:90,2:120,3:45)", WS_VISIBLE | WS_CHILD, 10, yPos + 18, 480, 15, hwnd, NULL, NULL, NULL);
    hCommandEdit = CreateWindow("EDIT", "", WS_VISIBLE | WS_CHILD | WS_BORDER | ES_LEFT | ES_AUTOHSCROLL | WS_TABSTOP, 10, yPos + 35, 350, 25, hwnd, (HMENU)1006, NULL, NULL);
    SendMessage(hCommandEdit, EM_SETLIMITTEXT, 127, 0);  // Increased for multiple commands
    hSendButton = CreateWindow("BUTTON", "Send", WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON | WS_TABSTOP, 370, yPos + 35, 60, 25, hwnd, (HMENU)1005, NULL, NULL);
    
    // Make Send button the default button (Enter key triggers it when focus is in edit box)
    SendMessage(hSendButton, BM_SETSTYLE, BS_DEFPUSHBUTTON, TRUE);
    
    UpdateSpeedDisplay();
}

// Scan for COM ports
void ScanPorts() {
    SendMessage(hComboBox, CB_RESETCONTENT, 0, 0);
    
    for (int i = 1; i <= 256; i++) {
        char port[32];
        sprintf(port, "COM%d", i);
        
        HANDLE hPort = CreateFile(port, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
        if (hPort != INVALID_HANDLE_VALUE) {
            SendMessage(hComboBox, CB_ADDSTRING, 0, (LPARAM)port);
            CloseHandle(hPort);
        }
    }
    
    if (SendMessage(hComboBox, CB_GETCOUNT, 0, 0) > 0) {
        SendMessage(hComboBox, CB_SETCURSEL, 0, 0);
    }
}

// Connect to Arduino
BOOL ConnectToArduino(const char* port) {
    if (isConnected) {
        return TRUE;
    }

    char fullPort[32];
    sprintf(fullPort, "\\\\.\\%s", port);  // Required for COM ports > COM9

    hSerial = CreateFile(fullPort, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    
    if (hSerial == INVALID_HANDLE_VALUE) {
        char msg[128];
        sprintf(msg, "Failed to open %s\nError: %lu", port, (unsigned long)GetLastError());
        MessageBox(hwndMain, msg, "Connection Error", MB_OK | MB_ICONERROR);
        return FALSE;
    }

    // Configure serial port
    DCB dcbSerialParams = {0};
    dcbSerialParams.DCBlength = sizeof(dcbSerialParams);
    
    if (!GetCommState(hSerial, &dcbSerialParams)) {
        CloseHandle(hSerial);
        hSerial = INVALID_HANDLE_VALUE;
        return FALSE;
    }

    dcbSerialParams.BaudRate = CBR_9600;
    dcbSerialParams.ByteSize = 8;
    dcbSerialParams.StopBits = ONESTOPBIT;
    dcbSerialParams.Parity = NOPARITY;
    dcbSerialParams.fDtrControl = DTR_CONTROL_ENABLE;

    if (!SetCommState(hSerial, &dcbSerialParams)) {
        CloseHandle(hSerial);
        hSerial = INVALID_HANDLE_VALUE;
        return FALSE;
    }

    // Set timeouts - more generous for stability
    COMMTIMEOUTS timeouts = {0};
    timeouts.ReadIntervalTimeout = 50;
    timeouts.ReadTotalTimeoutConstant = 50;
    timeouts.ReadTotalTimeoutMultiplier = 10;
    timeouts.WriteTotalTimeoutConstant = 200;  // Increased from 50 to 200ms
    timeouts.WriteTotalTimeoutMultiplier = 10;
    SetCommTimeouts(hSerial, &timeouts);
    
    // Set buffer sizes for better stability
    SetupComm(hSerial, 4096, 4096);  // 4KB input and output buffers

    // Purge buffers
    PurgeComm(hSerial, PURGE_RXCLEAR | PURGE_TXCLEAR);
    
    // Set event mask to monitor for errors
    SetCommMask(hSerial, EV_ERR | EV_TXEMPTY);

    isConnected = TRUE;
    strcpy(comPort, port);
    
    SetWindowText(hConnectButton, "Disconnect");
    
    char statusText[64];
    sprintf(statusText, "Connected to %s", port);
    SetWindowText(hStatusLabel, statusText);
    
    // Set green color for connected status
    statusColor = RGB(0, 150, 0);
    if (hStatusBrush) DeleteObject(hStatusBrush);
    hStatusBrush = CreateSolidBrush(GetSysColor(COLOR_WINDOW));
    InvalidateRect(hStatusLabel, NULL, TRUE);
    
    EnableWindow(hComboBox, FALSE);
    EnableWindow(hRefreshButton, FALSE);
    EnableWindow(hBaudComboBox, FALSE);

    // Wait for Arduino to reset and initialize
    Sleep(2000);
    
    // Clear any pending data from Arduino startup messages
    PurgeComm(hSerial, PURGE_RXCLEAR | PURGE_TXCLEAR);
    Sleep(500);
    
    // Read any startup messages to clear buffer and verify connection
    char tempBuffer[256];
    DWORD bytesRead = 0;
    ReadFile(hSerial, tempBuffer, sizeof(tempBuffer) - 1, &bytesRead, NULL);
    if (bytesRead > 0) {
        tempBuffer[bytesRead] = '\0';
        // Startup message received - connection is working
    }

    // Send all current positions to sync
    SendAllServos();

    return TRUE;
}

// Disconnect from Arduino
void DisconnectArduino() {
    if (hSerial != INVALID_HANDLE_VALUE) {
        CloseHandle(hSerial);
        hSerial = INVALID_HANDLE_VALUE;
    }
    
    isConnected = FALSE;
    SetWindowText(hConnectButton, "Connect");
    SetWindowText(hStatusLabel, "Disconnected");
    
    // Set red color for disconnected status
    statusColor = RGB(200, 0, 0);
    InvalidateRect(hStatusLabel, NULL, TRUE);
    
    EnableWindow(hComboBox, TRUE);
    EnableWindow(hRefreshButton, TRUE);
    EnableWindow(hBaudComboBox, TRUE);
}

// Send command to Arduino
BOOL SendCommand(int servoIndex, int angle, BOOL force) {
    if (!isConnected || hSerial == INVALID_HANDLE_VALUE) {
        return FALSE;
    }

    // Check if serial port is still valid
    DWORD errors;
    COMSTAT status;
    if (!ClearCommError(hSerial, &errors, &status)) {
        // Port is invalid, disconnect
        DisconnectArduino();
        MessageBox(hwndMain, "Serial port error detected. Connection lost.", "Error", MB_OK | MB_ICONERROR);
        return FALSE;
    }

    // Check for critical errors
    if (errors & (CE_BREAK | CE_FRAME | CE_IOE | CE_MODE | CE_OVERRUN | CE_RXOVER | CE_RXPARITY | CE_TXFULL)) {
        // Clear the errors
        ClearCommError(hSerial, &errors, &status);
        // Don't disconnect on minor errors, just retry
    }

    // Throttle commands
    if (!force) {
        DWORD currentTime = GetTickCount();
        if (currentTime - lastCommandTime < COMMAND_THROTTLE_MS) {
            return FALSE;
        }
        lastCommandTime = currentTime;
    }

    // Clamp angle
    if (angle < 0) angle = 0;
    if (angle > 180) angle = 180;

    // Format command: "index:angle\n"
    char command[32];
    sprintf(command, "%d:%d\n", servoIndex, angle);

    // Clear output buffer if it's getting full
    if (status.cbOutQue > 100) {
        PurgeComm(hSerial, PURGE_TXCLEAR);
    }

    DWORD bytesWritten;
    DWORD retries = 0;
    const DWORD MAX_RETRIES = 3;
    
    // Retry logic for write failures
    while (retries < MAX_RETRIES) {
        if (WriteFile(hSerial, command, strlen(command), &bytesWritten, NULL)) {
            // Check if all bytes were written
            if (bytesWritten == strlen(command)) {
                // Success - flush and update
                FlushFileBuffers(hSerial);
                
                // Update last sent angle for smooth movement tracking
                for (int i = 0; i < NUM_SERVOS; i++) {
                    if (servos[i].index == servoIndex) {
                        servos[i].lastSentAngle = angle;
                        break;
                    }
                }
                
                return TRUE;
            } else {
                // Partial write - this shouldn't happen but handle it
                // Try to write remaining bytes
                DWORD remaining = strlen(command) - bytesWritten;
                DWORD additionalWritten = 0;
                if (WriteFile(hSerial, command + bytesWritten, remaining, &additionalWritten, NULL)) {
                    bytesWritten += additionalWritten;
                    if (bytesWritten == strlen(command)) {
                        FlushFileBuffers(hSerial);
                        for (int i = 0; i < NUM_SERVOS; i++) {
                            if (servos[i].index == servoIndex) {
                                servos[i].lastSentAngle = angle;
                                break;
                            }
                        }
                        return TRUE;
                    }
                }
            }
        }
        
        // Write failed, check error
        DWORD error = GetLastError();
        if (error == ERROR_IO_PENDING) {
            // Wait a bit and retry
            Sleep(10);
            retries++;
            continue;
        } else if (error == ERROR_INVALID_HANDLE || error == ERROR_BAD_COMMAND) {
            // Port is invalid
            DisconnectArduino();
            MessageBox(hwndMain, "Serial port invalid. Connection lost.", "Error", MB_OK | MB_ICONERROR);
            return FALSE;
        }
        
        // Other error - clear and retry
        ClearCommError(hSerial, &errors, &status);
        Sleep(5);
        retries++;
    }
    
    // All retries failed
    if (retries >= MAX_RETRIES) {
        // Don't disconnect immediately, just report
        // The connection might recover
        return FALSE;
    }
    
    return FALSE;
}

// Send command with smooth movement (gradual transition)
void SendCommandSmooth(int servoIndex, int targetAngle) {
    if (!isConnected || hSerial == INVALID_HANDLE_VALUE) {
        return;
    }

    // Get current angle for this servo (last sent position)
    int currentAngle = 90;
    int servoIdx = -1;
    for (int i = 0; i < NUM_SERVOS; i++) {
        if (servos[i].index == servoIndex) {
            currentAngle = servos[i].lastSentAngle;  // Use last sent position, not slider position
            servoIdx = i;
            break;
        }
    }

    // Clamp target
    if (targetAngle < 0) targetAngle = 0;
    if (targetAngle > 180) targetAngle = 180;

    // If already at target, just send once
    if (abs(currentAngle - targetAngle) <= angleStep) {
        SendCommand(servoIndex, targetAngle, FALSE);
        return;
    }

    // Calculate direction and steps
    int direction = (targetAngle > currentAngle) ? 1 : -1;
    int steps = abs(targetAngle - currentAngle) / angleStep;
    if (steps == 0) steps = 1;

    // Calculate delay based on speed (1-100, higher = faster)
    // Speed 1 = ~100ms per step, Speed 100 = ~5ms per step
    int delayMs = 105 - movementSpeed;  // Inverted: higher speed = lower delay
    if (delayMs < 5) delayMs = 5;
    if (delayMs > 100) delayMs = 100;

    // Send intermediate positions
    for (int i = 1; i <= steps; i++) {
        // Check connection before each step
        if (!isConnected || hSerial == INVALID_HANDLE_VALUE) {
            return;  // Connection lost during smooth movement
        }
        
        int intermediateAngle = currentAngle + (direction * angleStep * i);
        
        // Clamp intermediate angle
        if (intermediateAngle < 0) intermediateAngle = 0;
        if (intermediateAngle > 180) intermediateAngle = 180;
        
        // Don't overshoot target
        if ((direction > 0 && intermediateAngle > targetAngle) ||
            (direction < 0 && intermediateAngle < targetAngle)) {
            intermediateAngle = targetAngle;
        }

        // Send command, if it fails, stop smooth movement
        if (!SendCommand(servoIndex, intermediateAngle, FALSE)) {
            // Command failed, check if connection is still valid
            if (!isConnected || hSerial == INVALID_HANDLE_VALUE) {
                return;  // Connection was lost
            }
            // If still connected, continue but skip delay to catch up
        }
        
        // Only delay if not at target
        if (intermediateAngle != targetAngle) {
            Sleep(delayMs);
        }
    }

    // Ensure final position is sent
    SendCommand(servoIndex, targetAngle, FALSE);
    
    // Update last sent angle for this servo (SendCommand already updates it, but ensure it's set)
    if (servoIdx >= 0) {
        servos[servoIdx].lastSentAngle = targetAngle;
    }
}

// Update speed display
void UpdateSpeedDisplay() {
    char speedText[16];
    sprintf(speedText, "%d%%", movementSpeed);
    SetWindowText(hSpeedLabel, speedText);
}

// Update servo display
void UpdateServoDisplay(int servoIdx) {
    if (servoIdx < 0 || servoIdx >= NUM_SERVOS) return;

    char value[16];
    sprintf(value, "%d°", servos[servoIdx].angle);
    SetWindowText(servos[servoIdx].value_label, value);
}

// Center all servos
void CenterAllServos() {
    for (int i = 0; i < NUM_SERVOS; i++) {
        servos[i].angle = 90;
        SendMessage(servos[i].slider, TBM_SETPOS, TRUE, 90);
        UpdateServoDisplay(i);
    }
    
    if (isConnected) {
        if (smoothMovement) {
            // Send all with smooth movement
            for (int i = 0; i < NUM_SERVOS; i++) {
                SendCommandSmooth(servos[i].index, 90);
            }
        } else {
            SendAllServos();
        }
    }
}

// Send all servo positions
void SendAllServos() {
    if (!isConnected) {
        return;
    }

    // Send commands with proper delays
    for (int i = 0; i < NUM_SERVOS; i++) {
        if (SendCommand(servos[i].index, servos[i].angle, TRUE)) {
            Sleep(50);  // Delay between commands
        } else {
            // Command failed, wait a bit longer before retry
            Sleep(100);
        }
    }
}

// Main entry point
int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    // Initialize common controls (for trackbar/slider support)
    InitCommonControls();

    // Register window class
    const char CLASS_NAME[] = "RoboticArmControllerClass";
    
    WNDCLASS wc = {0};
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = CLASS_NAME;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hIcon = LoadIcon(NULL, IDI_APPLICATION);

    if (!RegisterClass(&wc)) {
        MessageBox(NULL, "Window registration failed", "Error", MB_OK | MB_ICONERROR);
        return 1;
    }

    // Create window (taller to accommodate new controls)
    hwndMain = CreateWindowEx(
        0,
        CLASS_NAME,
        "6-DOF Robotic Arm Controller - Enhanced",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT,
        520, 570,
        NULL, NULL, hInstance, NULL
    );

    if (hwndMain == NULL) {
        MessageBox(NULL, "Window creation failed", "Error", MB_OK | MB_ICONERROR);
        return 1;
    }

    ShowWindow(hwndMain, nCmdShow);
    UpdateWindow(hwndMain);

    // Message loop
    MSG msg = {0};
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    DisconnectArduino();
    return (int)msg.wParam;
}

