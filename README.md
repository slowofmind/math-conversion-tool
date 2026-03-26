# Accessible STEM: A Toolkit for Instructor-Created Course Content
[Current working title, subject to change.]

So, I am applying for a 

## the problem: 

[Pandoc](https://pandoc.org/MANUAL.html) is a decent tool, for converting [LaTeX](https://www.learnlatex.org/en/) files with math content into accessible HTML, DOCX, and EPUB formats. It works well for relatively simple LaTeX files (short handouts, simple problem sets) that use relatively common LaTeX packages (amsmath, amssymb, enumitem if not customized), especially if using HTML output along with MathJax.

However, it can become more challenging when a LaTeX file contains any of the following:
- more specialized LaTeX packages (```diffcoeff```, ```ifthen```, ```siunitx``` in some cases)
- custom macros that take complex arguments,
- visual formatting mixed with semantically-relevant content (using ```xcolor``` commands in math environments)
- more advanced math content 
- various forms of image content (external graphics files saved as PDFs, programmatic graphics via TikZ/PGFplots)

It's possible to solve many of these problems via custom pre-processing scripts, output filters, or templates. However, the additional work required to create any of these can potentially discourage faculty adoption. Even when they are willing to put in the work to build their own custom solution, increased workloads mean that they don't often have the time. The ongoing work with **Digital Accessibility Services** to create guides and documentation is a necessary first step towards improving support for faculty, but at some point many instructors will hit a wall with complex LaTeX content and give up. So something more is needed.

## the solution
The logical next step would be to provide some sort of **toolkit or platform with pre-built tools, scripts, and templates** that extend Pandoc's existing capabilities so that faculty don't have to spend time creating their own infrastructure to do so. So that's what I've decided to try and do. 

I've created a very basic [proof of concept](https://code.harvard.edu/pages/nim022/math-conversion-tool/) that uses **[Pandoc-wasm](https://pandoc.org/releases.html#pandoc-3.9-2026-02-03) ("[Pandoc in the browser](https://pandoc.org/wasm-demo/)")** as a wrapper or platform and added the following:

- a basic [Ace code editor](https://ace.c9.io/) as an interface for performing minor edits in the browser
- a mechanism for highlighting potential problems in the code editor based on information generated directly from Pandoc error logs during conversion
- a simple [lua filter](https://pandoc.org/lua-filters.html) to help with basic formatting for ordered lists 
- two additional lua filters
	- one to resolve minor path issues with uploaded supplemental images
	- one that embeds image content (used to bypass a conflict between Pandoc's existing "embed resources" option and selecting MathJax an an option for HTML output.)
- an script that automatically converts auxilliary  PDF image files to PNGs or SVGs so that they can be properly included in HTML and DOCX output.
- a find and replace tool for working with the nested commands common in LaTeX that leverages the built-in error reporting
- an additional Pandoc math conversion option to allow use of MathJax version 4 (standard Pandoc still uses version 3)
- an option to download HTML output as a ```SCORM``` package; if Harvard's Canvas instance allows use of the LTI for [SCORM](https://community.instructure.com/en/kb/articles/660683-how-do-i-import-scorm-files-as-an-assignment), uploading in a SCORM package would prevent Canvas from blocking scripts included in the HTML — meaning instructors could use MathJax v4 instead of MathJax 2.9 (the current Canvas default)

For testing purposes, I've also added the option to use **[LaTeXML](https://math.nist.gov/~BMiller/LaTeXML/)** instead of Pandoc for conversion, as well as an option to compile to PDFs using TexLive 2026. Since these both require connections to external resources, I am not certain that I will include them in any kind of version for faculty (unless LaTeXML proves to be significantly useful)

## next steps

In addition to basic vetting of code and some serious accessibility testing and redesign, there are a number features that need to be enhanced or built from scratch. The potentially include:

- documentation for everything
- An "accessibility checker" for LaTeX files that to flag structural problems and offer suggested fixes
- better workflow for the "log file-to-editor" error display
- options for including MathJax scripts as separate files (rather than CDN links) with output; the goal would be to provide content that could be used offline (for when students lack reliable internet or taking exams where instructors want all internet connections to be disabled)
- a wide variety of lua filters for managing many of the problems mentioned earlier 
- ways to integrate both Pandoc and LaTeXML to take advantage of Pandoc's extensibility and multiple output formats as well as LaTeXML's deeper support for a wide range of LaTeX packages and content
- script templates for instructors to easily create their own lua filters (or bindings for LaTeXML)
- LaTeX templates to help instructors create content that works for both compiling to PDF and converting to other formats
- a GitHub action to allow Overleaf users with premium accounts to effectively run conversions from within Overleaf. (Not ideal, but might increase adoption)

## long term goals and questions

The biggest question is where this "platform" would live. If only using Pandoc and the various filters and scripts, it is theoretically possible to build a single HTML file where all processing happens client-side. This would make hosting relatively easy, and would even allow users to download the file and use it like a desktop app. However, if LaTeXMl turns out to make everything significantly easier for faculty, then ideally we would want a web server of some kind. (My understanding is that docker images cannot be hosted in the Harvard enterprise vesion of GitHub, and while hosting via my personal external account works for testing, it's not a viable long term solution)

I have no strong opinions on who would own this long term; I'm happy to provide support beyond the initial project year, and the basic infrastructure is stable enough to likely require mimimal upkeep. However, these decisions require input from different stakeholders regardless of whether it ends up being hosted by the ATC, DAS, UDR, or another group.




