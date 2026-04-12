# Makefile for Robotic Arm Controller
# Requires MinGW or similar GCC compiler for Windows

CC = gcc
CFLAGS = -Wall -O2
LIBS = -lgdi32 -luser32 -lcomdlg32 -lcomctl32
TARGET = robotic_arm_controller.exe
SOURCE = robotic_arm_controller.c

$(TARGET): $(SOURCE)
	$(CC) $(CFLAGS) -o $(TARGET) $(SOURCE) $(LIBS)

clean:
	del $(TARGET) 2>nul || rm -f $(TARGET)

.PHONY: clean

