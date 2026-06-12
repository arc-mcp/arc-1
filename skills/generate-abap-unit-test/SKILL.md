---
name: generate-abap-unit-test
description: Generate ABAP Unit tests for classes with dependency analysis, interface-based test doubles, and method-level surgical insertion. Use when asked to "generate unit tests for this class", "add ABAP Unit tests", "write tests for this method", or "create test doubles for ZCL_X".
---

# Generate ABAP Unit Test

Generate ABAP Unit tests for classes with dependency analysis, test doubles, and method-level surgery.

This skill replicates SAP Joule's "Unit Test Generation" capability for ABAP classes by combining ARC-1 (SAP system access) with mcp-sap-docs (documentation & best practices). Unlike the CDS unit test skill which targets CDS entities, this skill targets ABAP classes and uses interface-based test doubles instead of CDS Test Double Framework.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Test class name | `ltc_<short_class_name>` | ABAP Unit tests for a global class belong in its local `testclasses` (CCAU) include |
| Methods to test | All public methods | User can narrow after seeing the list |
| Package | `$TMP` | Fast prototyping |
| Risk level | `HARMLESS` | Test doubles don't modify real data |
| Duration | `SHORT` | Unit tests should be fast |
| Mock strategy | Interface-based test doubles | Cleanest pattern for dependency injection |

## Input

The user provides an ABAP class to test (e.g., `ZCL_TRAVEL_HANDLER`).

Only the **class name** is required. If the user provides just a class name, apply Smart Defaults and proceed immediately.

Optionally, the user may specify:
- **Test class name** (default: local class `ltc_<short_class_name>` inside the target class's `testclasses` include)
- **Methods to test** (default: all public methods)
- **Package** (default: `$TMP`)
- **Transport request** (only needed for non-`$TMP` packages)

## Step 1: Gather Class Context

Read the class, its methods, dependencies, and any existing tests.

### 1a. Read the full class source

Prefer the structured format to get metadata and all includes (including existing tests) in one call:

```
SAPRead(type="CLAS", name="<class_name>", format="structured")
```

This returns JSON with metadata (description, category, package) and decomposed source (main, testclasses, definitions, implementations, macros). The `testclasses` field contains existing test code if any — useful for analyzing what's already covered without a separate fetch.

Alternatively, for just the main source:

```
SAPRead(type="CLAS", name="<class_name>")
```

### 1b. List all methods with signatures

```
SAPRead(type="CLAS", name="<class_name>", method="*")
```

Returns all methods with their signatures and visibility (public/protected/private). Use this to understand the class API and identify which methods to test.

### 1c. Get dependency context

```
SAPContext(type="CLAS", name="<class_name>")
```

Automatically extracts all dependencies and fetches compressed public API contracts for each. This gives you:
- Implemented interfaces and their methods
- Superclass hierarchy
- Injected dependencies (constructor parameters)
- Used classes and their public APIs
- Database tables accessed

For complex classes with deep dependency chains, use `depth=2`:

```
SAPContext(type="CLAS", name="<class_name>", depth=2)
```

### 1d. (Optional) Read existing test classes

If you used `format="structured"` in Step 1a, the `testclasses` field already contains existing test code (or null if none) — skip this step.

Otherwise, fetch test classes separately:

```
SAPRead(type="CLAS", name="<class_name>", include="testclasses")
```

This may fail if no test classes exist — that's fine. If tests exist, analyze them to avoid duplicating coverage and to follow existing test patterns.

## Step 2: Analyze Methods and Propose Test Cases

For each public method, analyze the source code to identify testable scenarios.

### Dependency Classification

Classify each dependency the class uses:

| Category | What to Look For | Test Strategy |
|---|---|---|
| **Mockable** | Constructor injection via interfaces (`if_*`, `zif_*`) | Create test double implementing the interface |
| **Stubbable** | Database access (SELECT, INSERT, UPDATE, DELETE) | Prepare fixture data in SETUP, or use test double for DB layer |
| **Transparent** | Internal private/protected helper methods | Don't mock — they execute normally |
| **Framework** | Static calls to SAP framework classes (e.g., `cl_abap_context_info`) | Wrap in injectable interface or accept limitation |

### Analysis Per Method

For each public method, identify:
- **Branches**: IF/CASE/COND/SWITCH statements — each branch needs a test
- **Error paths**: RAISE EXCEPTION, TRY-CATCH blocks — test error scenarios
- **Return values**: What the method produces — verify outputs
- **State changes**: Side effects on instance attributes or database — verify mutations
- **Dependencies used**: Which mockable dependencies are called — set up expectations

### Output to User

Present the identified test cases as a numbered list grouped by method:

```
Identified test cases for ZCL_TRAVEL_HANDLER:

Method: CREATE_TRAVEL (public)
  1. [HAPPY] test_create_travel_success — Create travel with valid data, verify travel ID returned
  2. [ERROR] test_create_no_customer — Missing customer, expect CX_TRAVEL_ERROR
  3. [BRANCH] test_create_with_discount — Discount > 0 triggers calculation path

Method: VALIDATE_DATES (public)
  4. [HAPPY] test_dates_valid — End date after begin date
  5. [ERROR] test_dates_reversed — Begin date after end date, expect exception
  6. [EDGE] test_dates_same_day — Same begin and end date, should be valid
```

Ask the user: **"Which test cases should I generate? (all / specific numbers / skip any?)"**

If the user says "all" or doesn't respond with preferences, generate all.

## Step 3: Fetch Test Framework Reference

Use mcp-sap-docs to get the latest ABAP Unit and test double patterns.

```
search("ABAP Unit cl_abap_unit_assert")
```

```
search("test double interface mock ABAP")
```

Use the returned documentation to inform the generated code patterns. Key things to verify:
- Correct `cl_abap_unit_assert` assertion method names (`assert_equals`, `assert_initial`, `assert_not_initial`, `assert_bound`, `fail`)
- Test double creation patterns for interfaces
- `FOR TESTING` class and method syntax
- Risk level and duration annotations

## Step 4: Generate Test Class

Generate a complete ABAP test class following this structure:

### Template

```abap
"! @testing <CLASS_UNDER_TEST>
CLASS <test_class_name> DEFINITION
  FINAL
  FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PUBLIC SECTION.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CLASS-DATA cut TYPE REF TO <class_under_test>.
    " Test doubles for mockable dependencies
    CLASS-DATA mock_<dep1> TYPE REF TO <interface_1>.
    CLASS-DATA mock_<dep2> TYPE REF TO <interface_2>.

    CLASS-METHODS class_setup RAISING cx_static_check.
    CLASS-METHODS class_teardown.
    METHODS setup.

    "! <description of test case 1>
    METHODS <test_method_1> FOR TESTING RAISING cx_static_check.
    "! <description of test case 2>
    METHODS <test_method_2> FOR TESTING RAISING cx_static_check.
    " ... one method per selected test case
ENDCLASS.

CLASS <test_class_name> IMPLEMENTATION.

  METHOD class_setup.
    " One-time initialization — create test doubles
    " If using a test double framework:
    " mock_<dep1> = cl_abap_testdouble=>create( '<interface_1>' ).
    " Or create a local test double class (see below)
  ENDMETHOD.

  METHOD class_teardown.
    " Clean up
  ENDMETHOD.

  METHOD setup.
    " Per-test CUT instantiation with fresh state
    " Inject test doubles via constructor
    cut = NEW <class_under_test>(
      io_<dep1> = mock_<dep1>
      io_<dep2> = mock_<dep2>
    ).
  ENDMETHOD.

  METHOD <test_method_1>.
    " Arrange — configure mock behavior
    " cl_abap_testdouble=>configure_call( mock_<dep1>
    "   )->returning( VALUE #( <expected_return> ) )->and_expect( )->is_called_once( ).
    " mock_<dep1>-><method>( ).

    " Act — call the method under test
    DATA(lv_result) = cut-><method>( <params> ).

    " Assert — verify expected behavior
    cl_abap_unit_assert=>assert_equals(
      act = lv_result
      exp = <expected_value>
      msg = '<assertion message>' ).
  ENDMETHOD.

  METHOD <test_method_error>.
    " Arrange — set up conditions that trigger the error

    " Act & Assert — expect exception
    TRY.
        cut-><method>( <invalid_params> ).
        cl_abap_unit_assert=>fail( msg = 'Expected exception was not raised' ).
      CATCH <exception_class> INTO DATA(lx_error).
        " Optionally verify exception details
        cl_abap_unit_assert=>assert_not_initial(
          act = lx_error->get_text( )
          msg = 'Exception message should not be empty' ).
    ENDTRY.
  ENDMETHOD.

  " ... more test methods

ENDCLASS.
```

### Local Test Double Pattern

When `cl_abap_testdouble` is not available or the interface is complex, create a local test double class:

```abap
" Local test double — defined in the test include
CLASS lcl_mock_<dep> DEFINITION FOR TESTING.
  PUBLIC SECTION.
    INTERFACES <interface>.
    DATA last_<method>_input TYPE <param_type>.
    DATA <method>_result TYPE <return_type>.
ENDCLASS.

CLASS lcl_mock_<dep> IMPLEMENTATION.
  METHOD <interface>~<method>.
    last_<method>_input = <param>.
    <return_param> = <method>_result.
  ENDMETHOD.
ENDCLASS.
```

### Test Data Generation Rules

Follow these principles when generating test data:

1. **Minimal data**: Use the fewest values needed to exercise the scenario. Typically 1-3 records per test.
2. **Obvious values**: Choose values where the expected result is trivially verifiable:
   - For calculations: use 100.00 - 10.00 = 90.00, not 37.83 - 4.27
   - For status checks: use exactly the status values from the IF/CASE expression
   - For string operations: use short, recognizable strings
3. **Type-correct**: Match ABAP types exactly:
   - Use `'001'` for NUMC fields (string with leading zeros)
   - Use `'100.00'` for DEC/CURR fields
   - Use `'20260101'` for DATS fields
   - Use `abap_true` / `abap_false` for ABAP_BOOL
4. **Deterministic**: Never use `sy-datum`, `sy-uzeit`, `cl_abap_context_info=>get_system_date( )`, or random values
5. **Isolated**: Each test method should be self-contained — setup method ensures fresh CUT state

### Naming Conventions

- Test class: local class `ltc_<short_class_name>` in the class's `testclasses` include
- Test methods: `test_<method>_<scenario>` (e.g., `test_create_success`, `test_validate_no_date`)
- Use snake_case for method names (ABAP convention for test methods)
- Keep method names under 30 characters
- Mock variables: `mock_<short_dep_name>` (e.g., `mock_persistence`, `mock_validator`)

## Step 5: Preview and Confirm

Show the user the complete generated `testclasses` include source code and ask:

**"Here's the generated testclasses include. Should I write it to the SAP system? (yes / edit first / cancel)"**

If the user wants edits, incorporate them before proceeding.

## Step 6: Write, Activate, and Test

### 6-pre. Lint-check generated code (optional)

Before writing, validate the generated code against lint rules:

```
SAPLint(action="lint", source="<generated_testclasses_include>", name="<class_under_test>")
```

Fix any lint findings before proceeding. Pre-write lint validation also runs automatically when enabled (default: on).

### 6a. Write the local test class to the target class's testclasses include

```
SAPWrite(action="update", type="CLAS", name="<class_under_test>", include="testclasses", source="<generated_testclasses_include>", transport="<transport>")
```

This is a local include write, not a separate global class create. Do not pass a lock handle or add lock/unlock code to the ABAP source; ARC-1 performs the ADT lock -> initialize missing CCAU include -> write -> unlock sequence internally. On a fresh class, ARC-1 auto-creates the missing `testclasses` include before writing.

### 6b. Update existing tests

```
SAPWrite(action="update", type="CLAS", name="<class_under_test>", include="testclasses", source="<full_updated_testclasses_include>", transport="<transport>")
```

For a small fix to an existing local test method, use method surgery after the include exists:

```
SAPWrite(action="edit_method", type="CLAS", name="<class_under_test>", method="<ltc_class>~<failing_method>", source="<fixed_method_body>")
```

**Note:** For update actions, `transport` is recommended but not always required. ARC-1 auto-propagates the lock-provided `corrNr` when no explicit transport is supplied.

### 6c. Activate the class under test

```
SAPActivate(type="CLAS", name="<class_under_test>")
```

Activation returns structured responses with detailed error/warning messages including line numbers. Use these to pinpoint exact issues.

### 6d. Run the unit tests

```
SAPDiagnose(action="unittest", type="CLAS", name="<class_under_test>")
```

### 6e. Report results and fix failures

Show the user:
- Number of tests passed / failed / skipped
- For any failures: the assertion message and which test method failed
- Suggested fixes for any failures

If tests fail:
1. Analyze the failure message
2. Determine if it's a mock setup issue, assertion issue, or CUT logic issue
3. Fix the specific test method using method surgery:
   ```
   SAPWrite(action="edit_method", type="CLAS", name="<class_under_test>", method="<ltc_class>~<failing_method>", source="<fixed_source>")
   ```
4. Re-activate and re-run

## Error Handling

### Common Issues and Fixes

| Error | Cause | Fix |
|---|---|---|
| `class_setup` fails | Wrong CUT instantiation — missing constructor parameter or wrong type | Check CUT constructor signature, ensure all required dependencies are injected |
| Mock injection fails | Constructor parameter type mismatch — mock doesn't implement expected interface | Verify interface name, check if CUT expects concrete class instead of interface |
| Assertion fails | Wrong expected value or test data | Re-check CUT method logic, adjust expected value or input data |
| Activation error | Syntax error in generated code — typo, wrong type, missing variable declaration | Read activation error, fix syntax, re-activate |
| `cl_abap_testdouble` not found | Test double framework not available on system (older releases) | Use local test double class pattern instead |
| Method not found on CUT | Method is private or protected — not callable from test | Test only public methods; for protected, use `FRIENDS` clause |
| `testclasses`/CCAU include missing | Fresh class has no ABAP Unit include yet | Use `SAPWrite(action="update", type="CLAS", include="testclasses", source=...)`; ARC-1 auto-initializes it |
| Method not found in `edit_method` | The local `ltc_*` method does not exist yet, or the wrong local class name was used | First write the full `testclasses` include with `update include="testclasses"`, then use `edit_method` for existing methods |

## Notes

### BTP vs On-Premise Differences

- **BTP**: Write local `ltc_*` test classes into custom Z*/Y* classes. Must use ABAP Cloud syntax — no classic ABAP statements. Only released APIs are available for mocking. `cl_abap_testdouble` is available. Constructor injection is the standard pattern.
- **On-Premise**: Full flexibility. Can use classic ABAP. `cl_abap_testdouble` available from 7.51+. On older systems, use local test double classes.

### What This Skill Does NOT Do

- **No CDS unit tests**: For CDS entities, use generate-cds-unit-test skill (uses CDS Test Double Framework)
- **No integration tests**: This generates isolated unit tests with mocked dependencies, not end-to-end flows
- **No performance tests**: Use ABAP profiler (SAPDiagnose) for performance analysis
- **No RAP behavior tests**: For RAP BO test doubles, a separate pattern is needed

### When to Use This Skill

- When a class has non-trivial business logic in public methods
- When the class uses dependency injection (constructor parameters with interfaces) — ideal for mocking
- When the user wants test coverage as a starting point for TDD
- When refactoring a class and wanting regression tests before making changes
- NOT for classes with no public methods or pure data containers (structures/constants) — if analysis in Step 2 finds no testable scenarios (no branches, no error paths, no meaningful return values), warn the user: *"This class has no non-trivial public methods to test. Consider whether unit tests add value here."*
