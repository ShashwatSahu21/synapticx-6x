/*
 * Simple Serial Test Program
 * Tests if serial communication is working
 * Compile: gcc -o test_serial.exe test_serial.c
 * Usage: test_serial.exe COM3
 */

#include <windows.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char* argv[]) {
    if (argc < 2) {
        printf("Usage: test_serial.exe COMx\n");
        printf("Example: test_serial.exe COM3\n");
        return 1;
    }

    char fullPort[32];
    sprintf(fullPort, "\\\\.\\%s", argv[1]);
    
    printf("Opening %s...\n", fullPort);
    
    HANDLE hSerial = CreateFile(fullPort, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    
    if (hSerial == INVALID_HANDLE_VALUE) {
        printf("ERROR: Failed to open port. Error: %lu\n", GetLastError());
        return 1;
    }
    
    printf("Port opened successfully!\n");
    
    // Configure serial port
    DCB dcb = {0};
    dcb.DCBlength = sizeof(dcb);
    
    if (!GetCommState(hSerial, &dcb)) {
        printf("ERROR: Failed to get comm state\n");
        CloseHandle(hSerial);
        return 1;
    }
    
    dcb.BaudRate = CBR_9600;
    dcb.ByteSize = 8;
    dcb.StopBits = ONESTOPBIT;
    dcb.Parity = NOPARITY;
    dcb.fDtrControl = DTR_CONTROL_ENABLE;
    
    if (!SetCommState(hSerial, &dcb)) {
        printf("ERROR: Failed to set comm state\n");
        CloseHandle(hSerial);
        return 1;
    }
    
    printf("Serial port configured: 9600,8,N,1\n");
    
    // Set timeouts
    COMMTIMEOUTS timeouts = {0};
    timeouts.ReadIntervalTimeout = 50;
    timeouts.ReadTotalTimeoutConstant = 50;
    timeouts.ReadTotalTimeoutMultiplier = 10;
    timeouts.WriteTotalTimeoutConstant = 200;
    timeouts.WriteTotalTimeoutMultiplier = 10;
    SetCommTimeouts(hSerial, &timeouts);
    
    // Purge buffers
    PurgeComm(hSerial, PURGE_RXCLEAR | PURGE_TXCLEAR);
    
    printf("\nWaiting 2 seconds for Arduino to initialize...\n");
    Sleep(2000);
    
    // Read any startup messages
    char buffer[256];
    DWORD bytesRead = 0;
    if (ReadFile(hSerial, buffer, sizeof(buffer) - 1, &bytesRead, NULL) && bytesRead > 0) {
        buffer[bytesRead] = '\0';
        printf("Received from Arduino: %s\n", buffer);
    }
    
    // Test sending a command
    printf("\nSending test command: 1:90\\n\n");
    char command[] = "1:90\n";
    DWORD bytesWritten = 0;
    
    if (WriteFile(hSerial, command, strlen(command), &bytesWritten, NULL)) {
        printf("WriteFile returned TRUE, bytesWritten = %lu (expected %zu)\n", bytesWritten, strlen(command));
        FlushFileBuffers(hSerial);
        
        if (bytesWritten == strlen(command)) {
            printf("SUCCESS: Command sent correctly!\n");
        } else {
            printf("WARNING: Not all bytes were written!\n");
        }
    } else {
        printf("ERROR: WriteFile failed. Error: %lu\n", GetLastError());
    }
    
    // Wait for response
    printf("\nWaiting for response (5 seconds)...\n");
    Sleep(5000);
    
    bytesRead = 0;
    if (ReadFile(hSerial, buffer, sizeof(buffer) - 1, &bytesRead, NULL) && bytesRead > 0) {
        buffer[bytesRead] = '\0';
        printf("Response from Arduino:\n%s\n", buffer);
    } else {
        printf("No response received.\n");
    }
    
    printf("\nTest complete. Closing port...\n");
    CloseHandle(hSerial);
    
    return 0;
}

