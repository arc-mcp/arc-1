REPORT zarc1_e2e_dump.
* ARC-1 E2E diagnostics dump fixture.
* Do not run manually; execution intentionally raises COMPUTE_INT_ZERODIVIDE.

DATA lv_zero TYPE i VALUE 0.
DATA lv_result TYPE i.

lv_result = 1 / lv_zero.
