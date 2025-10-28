#!/bin/bash
# Linux-specific launcher for Claudia with proper window decoration support
#
# This script sets environment variables to ensure window decorations work properly on Linux:
# - GTK_CSD=0: Disables GTK client-side decorations, forcing server-side decorations
# - WEBKIT_DISABLE_DMABUF_RENDERER=1: Fixes rendering issues on some Linux systems
# - GDK_BACKEND=x11: Forces X11 mode (alternative if decorations still don't work on Wayland)

# Detect if running on Wayland
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo "Detected Wayland session. Starting with X11 backend for better window decoration support..."
    export GDK_BACKEND=x11
fi

# Disable GTK client-side decorations
export GTK_CSD=0

# Fix WebKit rendering issues
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# Run the app
if [ -f "src-tauri/target/debug/tauri-app" ]; then
    ./src-tauri/target/debug/tauri-app
elif [ -f "src-tauri/target/release/tauri-app" ]; then
    ./src-tauri/target/release/tauri-app
else
    echo "Error: Tauri app binary not found. Please build the app first with 'npm run tauri build' or 'cargo build' in src-tauri/"
    exit 1
fi
