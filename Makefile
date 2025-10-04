.PHONY: audit-demo

audit-demo:
	cargo run -p tyrum-planner --bin audit_demo --features audit-demo
