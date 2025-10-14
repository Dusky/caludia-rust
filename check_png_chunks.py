#!/usr/bin/env python3
import struct
import sys

def read_png_chunks(filename):
    with open(filename, 'rb') as f:
        # Check PNG signature
        signature = f.read(8)
        if signature != b'\x89PNG\r\n\x1a\n':
            print("Not a valid PNG file!")
            return
        
        print("Valid PNG file")
        print("\nChunks found:")
        print("-" * 60)
        
        chunk_num = 0
        while True:
            # Read chunk length
            length_data = f.read(4)
            if len(length_data) < 4:
                break
            
            length = struct.unpack('>I', length_data)[0]
            
            # Read chunk type
            chunk_type = f.read(4)
            if len(chunk_type) < 4:
                break
            
            chunk_type_str = chunk_type.decode('ascii', errors='ignore')
            
            # Read chunk data
            data = f.read(length)
            
            # Read CRC
            crc = f.read(4)
            
            chunk_num += 1
            
            # Print chunk info
            print(f"{chunk_num}. Type: {chunk_type_str:8s} | Length: {length:8d} bytes", end='')
            
            # For text chunks, show the keyword
            if chunk_type_str in ['tEXt', 'iTXt', 'zTXt']:
                try:
                    # Find null terminator for keyword
                    null_pos = data.find(b'\x00')
                    if null_pos > 0:
                        keyword = data[:null_pos].decode('latin-1', errors='ignore')
                        print(f" | Keyword: '{keyword}'", end='')
                        
                        # For tEXt, show some of the text content
                        if chunk_type_str == 'tEXt' and len(data) > null_pos + 1:
                            text_preview = data[null_pos+1:null_pos+51]
                            print(f" | Text: {text_preview[:50]}...", end='')
                except:
                    pass
            
            print()
            
            if chunk_type_str == 'IEND':
                break
        
        print("-" * 60)
        print(f"Total chunks: {chunk_num}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: check_png_chunks.py <png_file>")
        sys.exit(1)
    
    read_png_chunks(sys.argv[1])
