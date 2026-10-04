include scripts/kit.mk

# The checks one at a time, the providers (real logins and the network: the user's to run), the screenshots.
.PHONY: imports parsers providers shots

imports parsers providers:
	@$(DEV) $@

shots:
	@$(NESTED) shots
