# Pandoc-for-STEM

This tool designed to help teaching staff convert LaTeX course materials in to accessible formats as an alternative to compiling to PDF. The core is a version of Pandoc compiled into web asssembly ("Pandoc in the browser"); it can theoretically be run offline from a user desktop as well as run online but without any files leaving the user's local web browser.

The tool also includes a number of custom features in various states of completion:

1. An Ace code editor panel for minor LaTeX edits
2. An output panel with three different viewing options:
   - Preview for HTML output
   - Source code viewer for HTML output
   - Error panel showing the output from the Pandoc log file; this contains both actual conversion errors as well as general conversion information.
3. A number of hardcoded lua filters which can be toggled on and off; these include a filter for correcting minor issues with nested ```enumerate``` environments when converting HTML, a filter for dealing with file path issues with uploaded images, and a filter that converts upload images into base64 and embeds them directly into an output HTML file. (This allows student to receive a single inclusive HTML file and avoids a conflict between Pandoc's built-in "embed resources" and using MathJax via CDN.


