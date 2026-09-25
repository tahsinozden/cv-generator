.PHONY: install generate-cv build build-role watch clean help

help:
	@echo "CV generator targets (3 variants: full, lead, staff):"
	@echo "  make install              - install npm dependencies"
	@echo "  make build                - build all variant PDFs and Markdown"
	@echo "  make build-role ROLE=staff- build a single variant (full|lead|staff)"
	@echo "  make generate-cv          - alias for build"
	@echo "  make watch                - rebuild the full variant on file changes"
	@echo "  make watch-role ROLE=lead - watch a single variant"
	@echo "  make clean                - remove generated PDFs and Markdown"
	@echo "  make help                 - show this help"

install:
	npm install

build: generate-cv

build-role:
	node src/generate.mjs --role $(ROLE)

generate-cv:
	node src/generate.mjs

watch:
	node src/generate.mjs --role $(or $(ROLE),full) --watch

watch-role:
	node src/generate.mjs --role $(ROLE) --watch

clean:
	rm -f data/*.pdf data/CV*.md data/CV_markdown.zip preview-*.png
