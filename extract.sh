#!/bin/bash

# Extract all zip files in the current directory
for zipfile in *.zip; do
    if [ -f "$zipfile" ]; then
        echo "Extracting $zipfile..."
        unzip -o "$zipfile"
        echo "Successfully extracted $zipfile"
    fi
done

echo "All zip files have been extracted!"
