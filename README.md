# Pandoc-for-STEM

> [!WARNING]
> This tool currently sits somewhere in the range between proof-of-concept and mad ravings. The code is in need of serious review; it was constructed largely via LLM (a mix of Claude Sonnet and Opus models). It works for Pandoc conversions, and the cleanup tool is somewhat functional (if you know how to use it), but the code and the styling should be poked carefully from a distance with a long stick. You have been warned.

Still here? Ok. This tool is designed to help teaching staff convert LaTeX course materials in to accessible formats as an alternative to compiling to PDF. The core is a version of ```Pandoc.wasm``` ("Pandoc in the browser"); it could theoretically be run offline from a user's desktop as well as hosted as a web page online but without any files leaving the user's local web browser.

## The tool also includes a number of custom features in various states of completion:

1. An Ace code editor panel for minor LaTeX edits
2. An output panel with three different viewing options:
   - Preview for HTML output
   - Code viewer for underlying HTML output
   - Error panel showing the output from the Pandoc log file; this contains both actual conversion errors as well as general conversion information. Elements of the log file are piped to the code editor where they are highlighted to make review easier.
3. A "LaTeX Cleaning tool"; this is actually a language agnostic stack-based parser that handles nested the kind of nested commands (and occasionally environments) found in LaTeX. It offers options for editing the opening and closing "tags" of a command, removing them, or removing the tags and anything between them. The whole prefix/anchor/suffix structure takes some getting used to, but it's pretty robust. There is currently a partially-implemented experimental feature that autopopulates the fields with any element that Pandoc can't process during conversion. The profile system is not fully implemented at this time
4. Three hardcoded lua filters which can be toggled on and off; these include
    - a filter for correcting minor issues with nested ```enumerate``` environments when converting HTML
    - a filter for dealing with file path issues with uploaded images
    - a filter that converts uploaded images into base64 and embeds them directly into an output HTML file. (This allows student to receive a single inclusive HTML file and avoids a conflict between Pandoc's built-in "embed resources" and using MathJax via CDN.)
5. New math content conversion options for HTML output:
    - an option to use MathJax v4.1 via CDN (Pandoc's default MathJax option uses v3). 
    - the previous option also autoinserts a Mathjax config script so that "Include Hidden MathML" is enabled by default. MathJax normally has this option disabled due to "fragility" of hiding the MathML, and instead just inserts the MathJax-generated speech strings directly into the DOM. However this would mean that individuals using MathCat to control speech settings would be unabled to do so and could only use the MathJax options; including the hidden MathML gives them the full range of options.
    - possible future enhancement: user interface to customize Mathjax config for use with CDNs.
    - an option that bundles **all** of the necessary MathJax scripts directly into the HTML output file. While this signficantly increases the file size, it allows students to use and configure MathJax while offline (for when they do not have good internet access away from campus or if disabled for an exam). This would not be a solution to the problem of Canvas and the old version of MathJax; Canvas would still probably block the scripts from running even without the call to the CDNs.



## Additional features planned for this release

- adding more robust support for dealing with common LaTeX issues; make it easier to use the cleanup tool
- adding MuPDF handling to convert uploaded PDF images files into SVGs for insertion into conversion output
- including custom templates and references docx/pptx files prebuilt for accessibility purposes
- using YAML autocomplete/insertion for more user-friendly control of things like ordered lists, asides, conditional output


## Options for future releases

- additional support for DOCX and EPUB output

- add hooks to include LaTeXML as a conversion option: Perl options for web assembly are likely insufficient for dealing with LaTeXML, so we'd have to host a webserver. Possible features could include adding a different pipeline and functions for error correction and doing full document conversion, or only calling LaTeXML for converting math content and keeping Pandoc for overall document handling.

- Create a custom Pandoc build for recompiling web assembly. The idea would be to see if it is feasible to get rid of the Pandoc readers and writer that we don't need so we have a core set for the file types we need to handle (LaTeX, HTML, EPUB, DOCX, PPTX, Markdown) and possibly reduce the size of the wasm file down to something that would be easier to work with. Would require downloading and installing the Glasgow Haskell compiler and learning how to use it in WSL, and then seeing if it is even possible to build Pandoc this way...

