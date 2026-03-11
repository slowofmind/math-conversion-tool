# Pandoc-for-STEM

> [!WARNING]
> This tool currently sits somewhere in the range between proof-of-concept and mad ravings. It is not yet accessible and the code is in need of serious review; it was constructed largely via LLM (a mix of Claude Sonnet and Opus models). It works for Pandoc conversions, and the cleanup tool is functional (if you know how to use it), but the code and the styling should be poked carefully from a distance with a long stick. You have been warned.

Still here? Ok. This tool is designed to help teaching staff convert LaTeX course materials in to accessible formats as an alternative to compiling to PDF. The core is a version of ```Pandoc.wasm``` ("Pandoc in the browser"); it could theoretically be run offline from a user's desktop as well as hosted as a web page online but without any files leaving the user's local web browser.

The tool also includes a number of custom features in various states of completion:

1. An Ace code editor panel for minor LaTeX edits
2. An output panel with three different viewing options:
   - Preview for HTML output
   - Source code viewer for HTML output
   - Error panel showing the output from the Pandoc log file; this contains both actual conversion errors as well as general conversion information. Elements of the log file are piped to the code editor where they are highlighted to make review easier.
3. A "LaTeX Cleaning tool"; this is actually a language agnostic stack-based parser that handles nested the kind of nested commands (and occasionally environments) found in LaTeX. It offers options for editing the opening and closing "tags" of a command, removing them, or removing the tags and anything between them. The whole prefix/anchor/suffix structure takes some getting used to, but it's pretty robust. There is currently a partially-implemented experimental feature that autopopulates the fields with any element that Pandoc can't process during conversion. The profile system may
4. Three hardcoded lua filters which can be toggled on and off; these include a filter for correcting minor issues with nested ```enumerate``` environments when converting HTML, a filter for dealing with file path issues with uploaded images, and a filter that converts upload images into base64 and embeds them directly into an output HTML file. (This allows student to receive a single inclusive HTML file and avoids a conflict between Pandoc's built-in "embed resources" and using MathJax via CDN.)


