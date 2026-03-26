package main

// psUTF8Prefix is prepended to all PowerShell commands to force UTF-8 output encoding.
// Without this, non-ASCII characters (accents, special chars) are garbled on non-English
// Windows where the default console encoding is CP850/CP1252.
const psUTF8Prefix = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();$OutputEncoding=[System.Text.UTF8Encoding]::new();"
