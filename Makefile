.PHONY: validate checksums-write checksums-check package-check

validate:
	python scripts/validate_package.py

checksums-write:
	python scripts/generate_checksums.py --write

checksums-check:
	python scripts/generate_checksums.py --check

package-check: validate checksums-check
