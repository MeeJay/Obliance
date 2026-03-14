// build-tool: converts a WebP image to a multi-size .ico file.
// Usage: go run . <input.webp> <output.ico>
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"

	"github.com/chai2010/webp"
	"golang.org/x/image/math/f64"
	xdraw "golang.org/x/image/draw"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "Usage: convert_icon <input.webp> <output.ico>")
		os.Exit(1)
	}

	// Decode WebP
	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "open:", err)
		os.Exit(1)
	}
	defer f.Close()

	src, err := webp.Decode(f)
	if err != nil {
		fmt.Fprintln(os.Stderr, "decode webp:", err)
		os.Exit(1)
	}

	sizes := []int{16, 32, 48, 256}

	// Encode each size as PNG
	var pngBufs [][]byte
	for _, sz := range sizes {
		dst := image.NewRGBA(image.Rect(0, 0, sz, sz))
		// High-quality downscale using CatmullRom
		xdraw.CatmullRom.Transform(dst, f64.Aff3{
			float64(sz) / float64(src.Bounds().Dx()), 0, 0,
			0, float64(sz) / float64(src.Bounds().Dy()), 0,
		}, src, src.Bounds(), draw.Over, nil)

		var buf bytes.Buffer
		if err := png.Encode(&buf, dst); err != nil {
			fmt.Fprintln(os.Stderr, "encode png:", err)
			os.Exit(1)
		}
		pngBufs = append(pngBufs, buf.Bytes())
	}

	// Build ICO file
	// Header: 6 bytes
	// Directory: len(sizes) * 16 bytes
	// Image data: concatenated PNGs
	headerSize := 6
	dirEntrySize := 16
	dirSize := len(sizes) * dirEntrySize
	dataOffset := headerSize + dirSize

	var ico bytes.Buffer

	// ICONDIR
	binary.Write(&ico, binary.LittleEndian, uint16(0))           // reserved
	binary.Write(&ico, binary.LittleEndian, uint16(1))           // type = icon
	binary.Write(&ico, binary.LittleEndian, uint16(len(sizes))) // count

	// Calculate offsets
	offset := dataOffset
	for i, sz := range sizes {
		w := sz
		if w == 256 {
			w = 0 // 0 means 256 in ICO format
		}
		h := sz
		if h == 256 {
			h = 0
		}
		binary.Write(&ico, binary.LittleEndian, uint8(w))               // width
		binary.Write(&ico, binary.LittleEndian, uint8(h))               // height
		binary.Write(&ico, binary.LittleEndian, uint8(0))               // color count (0 = true-color)
		binary.Write(&ico, binary.LittleEndian, uint8(0))               // reserved
		binary.Write(&ico, binary.LittleEndian, uint16(1))              // planes
		binary.Write(&ico, binary.LittleEndian, uint16(32))             // bit count
		binary.Write(&ico, binary.LittleEndian, uint32(len(pngBufs[i]))) // bytes in resource
		binary.Write(&ico, binary.LittleEndian, uint32(offset))         // offset
		offset += len(pngBufs[i])
	}

	// Image data
	for _, buf := range pngBufs {
		ico.Write(buf)
	}

	if err := os.WriteFile(os.Args[2], ico.Bytes(), 0644); err != nil {
		fmt.Fprintln(os.Stderr, "write ico:", err)
		os.Exit(1)
	}

	fmt.Printf("Written %s (%d bytes, sizes: %v)\n", os.Args[2], ico.Len(), sizes)
}
