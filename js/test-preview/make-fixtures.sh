#!/bin/sh
# make-fixtures.sh — how fixtures/ was made (Pandoc 3.11 CLI, the platform's Pandoc release).
# Run from js/test-preview:  PANDOC=/path/to/pandoc sh make-fixtures.sh
# The outputs are committed, so the tests never need Pandoc.
set -e
P=${PANDOC:-pandoc}
cd fixtures/src
# Multipage: default chunk template (%s-%i.html), so LaTeX labels put colons in names.
# Table of contents on, the Canvas resize script at the end of every page.
$P workbook.tex -t chunkedhtml --toc --include-after-body=canvas-snippet.html -o ../workbook.zip
# The same document with a number-only chunk template.
$P workbook.tex -t chunkedhtml --chunk-template='%n.html' -o ../workbook-numbered.zip
# Single page, images left as separate files (as with the Canvas style).
$P single.tex -t html5 -s -o ../single.html
