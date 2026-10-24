Taelgarverse 0.7.1

- Add a temporary Sketch tool for map annotations, with freehand drawing, point outlines, Undo, and Clear. Drawings are kept only while the map is open and are never saved to notes.
- Automatically number closed shapes inside their outlines, including freehand shapes. Undo updates the labels and Clear restarts numbering.
- Make Close shape repair accidental crossings, loops, and retraced overshoots by keeping the larger enclosed region. Undo restores the original outline. Sketch uses the same correction when an outline snaps closed.
- Start Trace path whenever Sketch is entered and keep it ready for another drawing after Clear or Close shape.
- Allow sketching even when a map's measurement calibration is unavailable. Sketches and measurements remain separate when switching tools; Clear removes both.

Desktop only. The minimum app version remains Obsidian 1.8.0.
