PYTHON ?= python3

.PHONY: validate seed-check publication-check checksums-write checksums-check package-check

validate:
	$(PYTHON) scripts/validate_package.py

seed-check:
	pnpm seed:m3:check

publication-check:
	pnpm publication:m3:check
	pnpm publication:m3:self-test

checksums-write:
	$(PYTHON) scripts/generate_checksums.py --write

checksums-check:
	$(PYTHON) scripts/generate_checksums.py --check

package-check: validate seed-check publication-check checksums-check
