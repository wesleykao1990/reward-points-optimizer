PYTHON ?= python3

.PHONY: validate seed-check publication-check package-check

validate:
	$(PYTHON) scripts/validate_package.py

seed-check:
	pnpm seed:m3:check

publication-check:
	pnpm publication:m3:check
	pnpm publication:m3:self-test

package-check: validate seed-check publication-check
