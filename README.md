# Accessible Math Conversion Tool

> [!WARNING]
> This tool currently sits somewhere in the range between proof-of-concept and mad ravings. The code is in need of serious review; it was constructed largely via LLM (a mix of Claude Sonnet and Opus models). It works for Pandoc conversions, and the cleanup tool is somewhat functional (if you know how to use it), but the code and the styling should be poked carefully from a distance with a long stick. You have been warned.

Still here? Ok. The purpose of this tool is to provide a customized pipeline for teaching staff to convert their personal LaTeX course materials into accessible formats. While tools like Pandoc and LaTeXML already provide this ability, they can be tedious to install and configure, and often are opaque when it comes to figuring out how to convert complex or customized LaTeX source materials. A better idea is to wrap one or more existing conversion solutions in a custom interface along with specialized pre-built scripts and workflows designed to handle the kinds of files typically created by instructors.

For testing purposes, I've decided to make a number of different options available, add on a variety of features, and then compare to find out what works best. While the core was originally ```Pandoc-wasm``` ("Pandoc in the browser), I decided to add the ability to convert using LaTeXML, and also to compile to PDF using TexLive 2026 for purposes of comparing current experimental PDF tagging capabilities with HTML output. The latter two pipelines work via a docker image and GitHub actions loosely inspired by the "BookML" tool, but focused on producing a single standalone file for delivery. (This means that Pandoc-wasm isn't currently packaged for download and local desktop use.

## Here's what's currently included (in various stated of completion)

1. Options for converting using An Ace code editor panel for minor LaTeX edits
2. An output panel with three different viewing options:
   - Preview for HTML output
   - Code viewer for underlying HTML output
   - Error panel showing the output from the Pandoc log file; this contains both actual conversion errors as well as general conversion information. Elements of the log file are piped to the code editor where they are highlighted to make review easier.
3. A "LaTeX Cleaning tool"; this is actually a language agnostic stack-based parser that handles nested the kind of nested commands (and occasionally environments) found in LaTeX. It offers options for editing the opening and closing "tags" of a command, removing them, or removing the tags and anything between them. The whole prefix/anchor/suffix structure takes some getting used to, but it's pretty robust. There is currently a partially-implemented experimental feature that autopopulates the fields with any element that Pandoc can't process during conversion and also highlights the corresponding code in the editor The profile system is not fully implemented at this time.
4. Three hardcoded lua filters which can be toggled on and off; these include
    - a filter for correcting minor issues with nested ```enumerate``` environments when converting HTML
    - a filter for dealing with file path issues with uploaded images
    - a filter that converts uploaded images into base64 and embeds them directly into an output HTML file. (This allows student to receive a single inclusive HTML file and avoids a conflict between Pandoc's built-in "embed resources" and using MathJax via CDN.)
5. New math content conversion options for HTML output:
    - an option to use MathJax v4.1 via CDN (Pandoc's default MathJax option uses v3). 
    - the previous option also autoinserts a Mathjax config script so that "Include Hidden MathML" is enabled by default. MathJax normally has this option disabled due to "fragility" of hiding the MathML, and instead just inserts the MathJax-generated speech strings directly into the DOM. The MathJax Context Menu (right click on equation or shift+enter) can be used to change the settings back.
    - possible future enhancement: user interface to customize Mathjax config for use with CDNs.
5. ```SCORM``` Download option for HTML output: Canvas currently only supports the now outdated MathJax 2.9, and blocks scripts (including newer version of MathJax) in uploaded HTML files. A workaround discovered by math faculty at other institutions is to enable Canvas LTI support for ```SCORM```; while nearly two decades old, it wraps files in a framework that allows MathJax CDN scripts to run in Canvas. (Need verification: my trial version of Canvas does not support SCORM)





