#!/usr/bin/env python3

import os
import zipfile

# Extract all zip files in the current directory
for filename in os.listdir('.'):
    if filename.endswith('.zip'):
        print(f"Extracting {filename}...")
        with zipfile.ZipFile(filename, 'r') as zip_ref:
            zip_ref.extractall('.')
        print(f"Successfully extracted {filename}")

print("All zip files have been extracted!")
