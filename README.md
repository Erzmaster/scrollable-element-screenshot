# Scrollable Element Screenshot for Violentmonkey

Capture any scrollable element as a full PNG screenshot directly in your
browser — including nested scroll containers and content outside the visible area.

This Violentmonkey/Tampermonkey userscript lets you select a nested scrollable
container, automatically scrolls through it to load lazy content, and exports the
full element screenshot. It is useful for chat histories, tables, panels, lists,
dashboards, and other scrollable sections of a website.

## Features

- Point-and-click selection with a visible outline
- Full-height and full-width element capture
- Automatic scrolling for lazy-loaded content
- Automatic detection of the page's background color
- Restores the original scroll position after capture
- Saves the result as a PNG
- Works on all HTTP and HTTPS websites

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey.
2. Open the extension dashboard and create a new userscript.
3. Copy the contents of
   [`scrollable-element-capture.user.js`](scrollable-element-capture.user.js)
   into the editor and save it.
4. Reload the website you want to capture.

## Usage

1. Click the floating camera button in the bottom-right corner.
2. Move the pointer over the desired scrollable area.
3. Click when the cyan outline highlights the correct element.
4. Choose where to save the generated PNG. Press **Esc** to cancel selection.

Select the content beside the scrollbar instead of clicking the native scrollbar
thumb, because browsers handle scrollbar clicks differently.

## Limitations

The script uses `html2canvas`, as userscripts cannot access the browser's
privileged screenshot API. Cross-origin images without CORS permission, video,
WebGL/canvas content, browser-native controls, advanced CSS, and virtualized lists
may not be captured exactly as displayed.

## Keywords

Scrollable element screenshot, full-page screenshot, scrolling screenshot,
Violentmonkey userscript, Tampermonkey script, HTML element capture, long
screenshot, nested scroll container, html2canvas.

## License

Choose and add a license before publishing. The MIT License is a common choice for
small open-source userscripts.
