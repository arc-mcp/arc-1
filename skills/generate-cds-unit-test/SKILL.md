---
name: generate-cds-unit-test
description: Generate an ABAP Unit test class for a CDS entity using the CDS Test Double Framework — replicates SAP Joule's "CDS Unit Test Generation" capability. Use when asked to "generate CDS unit tests", "test this CDS view", "create CDSTDF tests", or "write unit tests for ZI_SALESORDER".
---

# Generate CDS Unit Test

Generate an ABAP Unit test class for a CDS entity using the CDS Test Double Framework.

This skill replicates SAP Joule's "CDS Unit Test Generation" capability by combining ARC-1 (SAP system access) with mcp-sap-docs (documentation & best practices).

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Test class name | `ZCL_TEST_<entity_name>` | Standard convention |
| Package | `$TMP` | Fast prototyping |
| Test scope | All testable semantics | User can narrow after seeing the list |
| Risk level | `HARMLESS` | CDS test doubles don't modify real data |
| Duration | `SHORT` | Unit tests should be fast |

## Input

The user provides a CDS entity name (e.g., `ZI_SALESORDER`, `ZC_TRAVEL`).

Only the **CDS entity name** is required. If the user provides just an entity name, apply Smart Defaults and proceed immediately.

Optionally, the user may specify:
- **Test class name** (default: `ZCL_TEST_<entity_name>`)
- **Package** (default: `$TMP`)
- **Transport request** (only needed for non-`$TMP` packages)

## Step 1: Gather CDS Entity Context

Read the CDS entity, its field structure, and all dependencies in just 3 tool calls.

### 1a. Read the CDS DDL source

```
SAPRead(type="DDLS", name="<entity_name>")
```

### 1b. Get structured field list

```
SAPRead(type="DDLS", name="<entity_name>", include="elements")
```

Returns a formatted listing of all fields with key markers, aliases, association references, and expression types (calculated, case, cast, coalesce). Use this to understand the entity's structure without parsing raw DDL.

### 1c. Get dependency context (tables, views, associations)

```
SAPContext(type="DDLS", name="<entity_name>")
```

Automatically extracts all data sources (FROM, JOIN), associations, compositions, and projection bases from the CDS DDL. For each dependency, fetches the full source with type fallback (DDLS → TABL → STRU). This gives you:
- Underlying table definitions with field types (needed for correctly-typed test data)
- Other CDS view sources (needed to understand transitive logic)
- Association targets

For deeper dependency graphs (e.g., a consumption view → interface view → table), use `depth=2`:

```
SAPContext(type="DDLS", name="<entity_name>", depth=2)
```

### 1d. (Optional) Read metadata extensions and behavior definition

```
SAPRead(type="DDLX", name="<entity_name>")
SAPRead(type="BDEF", name="<entity_name>")
```

These may fail if no DDLX/BDEF exists — that's fine, skip them. Only needed if the entity has UI annotations or RAP behavior.

## Step 2: Analyze CDS Semantics and Propose Test Cases

**Preferred (SAP_BASIS 8.16+ — ABAP Platform 2025 / S/4HANA 2025): ask SAP directly.** SAP analyzes the entity for you and returns the authoritative list of testable semantics — the same CDS Test Double Framework engine behind SAP Joule's CDS unit-test generation:

```
SAPDiagnose(action="cds_testcases", name="<entity_name>")
```

Each suggestion carries a ready `testMethod` name, a `semanticType` (`NONE` = whole view, `CALCULATION`, `CAST`, `JOIN`, `CASE`, …), a `description`, and — for calculated/cast cases — the `calculatedField`. **Use this as your proposed test-case list** for the "Output to User" block below: it is SAP's own analysis, so prefer it over hand-parsing the DDL. Map each `semanticType` onto the category table and each `testMethod` onto a `FOR TESTING` method in Step 4. If the tool returns a "requires SAP_BASIS 8.16+" message (older releases / NW 7.5x don't expose the endpoint), or you want to cross-check coverage, use the manual analysis below.

**Fallback / cross-check — analyze the DDL yourself.** Analyze the CDS DDL source you read in Step 1 and identify all testable semantics. Group them by category:

### Semantic Categories to Look For

| Category | What to Look For in DDL | Example Test Case |
|---|---|---|
| **Calculations** | Arithmetic expressions (`field1 * field2`, `field1 - field2`) | Insert known values, verify calculated result |
| **CASE expressions** | `case when ... then ... else ... end` | One test per branch |
| **Type casts** | `cast(field as abap.dec(15,2))`, `cast(field as abap.char(10))` | Insert value, verify cast output |
| **WHERE filters** | `where status = 'A'` or `where amount > 0` | Insert matching + non-matching rows, verify only matching appear |
| **HAVING clauses** | `having sum(amount) > 1000` | Insert data that triggers and doesn't trigger the filter |
| **JOINs** | `inner join`, `left outer join`, `association` | Insert matching keys in both tables; test with non-matching keys for outer joins |
| **Aggregations** | `sum()`, `count()`, `avg()`, `min()`, `max()` with `group by` | Insert multiple rows, verify aggregated result |
| **Null handling** | `coalesce(field, 'default')`, null-safe expressions | Insert row with null field, verify default |
| **Parameters** | `with parameters p_param : type` | Call view with parameter, verify filtering |
| **Currency/Unit conversion** | `currency_conversion()`, `unit_conversion()` | Insert conversion data, verify result |
| **String operations** | `concat()`, `substring()`, `length()` | Insert string values, verify output |
| **Associations** | `association [0..*] to ...` | Insert data in both sides, verify navigation |

### Output to User

Present the identified test cases as a numbered list:

```
Identified test cases for ZI_SALESORDER:

1. [CALCULATION] test_net_amount_calculation — Verify net_amount = gross_amount - discount
2. [CASE] test_status_text_open — Verify status 'O' maps to 'Open'
3. [CASE] test_status_text_closed — Verify status 'C' maps to 'Closed'
4. [JOIN] test_customer_join — Verify customer data is correctly joined
5. [WHERE] test_active_orders_filter — Verify only active orders are returned
6. [NULL] test_description_coalesce — Verify null description gets default value
```

Ask the user: **"Which test cases should I generate? (all / specific numbers / skip any?)"**

If the user says "all" or doesn't respond with preferences, generate all.

## Step 3: Fetch CDS Test Double Framework Reference

Use mcp-sap-docs to get the latest CDS Test Double Framework patterns. This ensures generated code follows SAP best practices.

```
search("CDS test double framework cl_cds_test_environment")
```

Also fetch:
```
search("ABAP Unit cl_abap_unit_assert")
```

Use the returned documentation to inform the generated code patterns. Key things to verify:
- Correct `cl_cds_test_environment=>create()` signature
- Correct `get_double()` / `insert()` pattern
- Correct assertion method names

## Step 4: Generate the Test Class

Generate a complete ABAP test class following this structure:

### Template

```abap
"! @testing <CDS_ENTITY_NAME>
CLASS <test_class_name> DEFINITION
  PUBLIC FINAL
  FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PUBLIC SECTION.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CLASS-DATA environment TYPE REF TO if_cds_test_environment.

    CLASS-METHODS class_setup    RAISING cx_static_check.
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
    environment = cl_cds_test_environment=>create( i_for_entity = '<CDS_ENTITY_NAME>' ).
  ENDMETHOD.

  METHOD class_teardown.
    environment->destroy( ).
  ENDMETHOD.

  METHOD setup.
    environment->clear_doubles( ).
  ENDMETHOD.

  METHOD <test_method_1>.
    " Arrange — prepare test data for underlying tables
    DATA lt_<table> TYPE STANDARD TABLE OF <underlying_table> WITH EMPTY KEY.
    lt_<table> = VALUE #(
      ( <field1> = '<value1>' <field2> = '<value2>' ... )
    ).
    environment->get_double( '<UNDERLYING_TABLE>' )->insert( lt_<table> ).

    " Act — SELECT from the CDS entity under test
    SELECT * FROM <cds_entity> INTO TABLE @DATA(lt_result).

    " Assert — verify expected behavior
    cl_abap_unit_assert=>assert_equals(
      act = lines( lt_result )
      exp = <expected_count>
      msg = |Expected { <expected_count> } rows| ).

    cl_abap_unit_assert=>assert_equals(
      act = lt_result[ 1 ]-<field>
      exp = '<expected_value>'
      msg = '<assertion message>' ).
  ENDMETHOD.

  " ... more test methods

ENDCLASS.
```

### Test Data Generation Rules

Follow these principles when generating test data:

1. **Minimal rows**: Use the fewest rows needed to exercise the semantic. Typically 1-3 rows per test.
2. **Obvious values**: Choose values where the expected result is trivially verifiable:
   - For `gross - discount = net`: use 100.00 - 10.00 = 90.00, not 37.83 - 4.27
   - For CASE branches: use exactly the values from the CASE expression
   - For WHERE filters: one row that passes, one that doesn't
3. **Type-correct**: Match ABAP types exactly:
   - Use `'001'` for NUMC fields (string with leading zeros)
   - Use `'100.00'` for DEC/CURR fields
   - Use `'20260101'` for DATS fields
   - Use `'EUR'` for CUKY fields
4. **Key fields populated**: Always fill key fields even if not directly tested
5. **Deterministic**: Never use random or date-dependent values
6. **Isolated**: Each test method should be self-contained (clear_doubles in setup ensures this)

### Naming Conventions

- Test class: `ZCL_TEST_<ENTITY>` or `ZCL_<ENTITY>_TEST`
- Test methods: `test_<semantic>_<detail>` (e.g., `test_status_case_open`, `test_net_amount_calc`)
- Use snake_case for method names (ABAP convention for test methods)
- Keep method names under 30 characters

## Step 5: Preview and Confirm

Show the user the complete generated test class source code and ask:

**"Here's the generated test class. Should I create it on the SAP system? (yes / edit first / cancel)"**

If the user wants edits, incorporate them before proceeding.

## Step 6: Create, Activate, and Test

### 6-pre. Lint-check generated code (optional)

Before writing, validate the generated code against lint rules:

```
SAPLint(action="lint", source="<generated_source>", name="<test_class_name>")
```

Fix any lint findings before proceeding. Pre-write lint validation also runs automatically when enabled (default: on).

### 6a. Create the test class

```
SAPWrite(action="create", type="CLAS", name="<test_class_name>", source="<generated_source>", package="<package>", transport="<transport>")
```

### 6b. Update the source (if create only scaffolds)

```
SAPWrite(action="update", type="CLAS", name="<test_class_name>", source="<generated_source>", transport="<transport>")
```

### 6c. Activate the test class

```
SAPActivate(type="CLAS", name="<test_class_name>")
```

Activation returns structured responses with detailed error/warning messages including line numbers. Use these to pinpoint exact issues.

### 6d. Run the unit tests

```
SAPDiagnose(action="unittest", type="CLAS", name="<test_class_name>")
```

### 6e. Report results

Show the user:
- Number of tests passed / failed / skipped
- For any failures: the assertion message and which test method failed
- Suggested fixes for any failures

If tests fail:
1. Analyze the failure message
2. Determine if it's a test data issue, assertion issue, or CDS logic issue
3. Fix the test method using `SAPWrite(action="edit_method", ...)`
4. Re-activate and re-run

## Error Handling

### Common Issues and Fixes

| Error | Cause | Fix |
|---|---|---|
| `CX_CDS_TEST_ENVIRONMENT` during class_setup | Entity name wrong or not active | Verify entity name, check activation status |
| Type mismatch in VALUE constructor | Wrong field type in test data | Check DD03L or table structure for correct types |
| `GET_DOUBLE` fails for a data source | Data source name doesn't match | Check CDS DDL for exact data source names (case-sensitive!) |
| Assertion fails with unexpected values | Test data or expected result wrong | Re-check CDS logic, adjust test data or assertion |
| Activation error: "test relation not found" | `@testing` annotation points to wrong entity | Fix entity name in `"! @testing` comment |
| Class exists already | Test class already created | Use `SAPWrite(action="update", ...)` instead |

## Notes

### BTP vs On-Premise Differences

- **BTP**: Only Z*/Y* classes can be created. Standard SAP tables cannot be queried via DD03L. Use released CDS entities for type reference.
- **On-Premise**: Full access to DD03L, DD02L for field catalogs. Can query TADIR for object existence checks.

### What This Skill Does NOT Do

- **Performance testing**: CDS Test Doubles are for logic testing, not performance
- **Authorization testing**: DCL/CDS access control testing requires separate patterns
- **Integration testing**: This generates isolated unit tests, not end-to-end flows
- **RAP behavior testing**: For validations/actions/determinations, use the RAP BO Test Double Framework instead

### When to Use This Skill

- When a CDS entity has non-trivial logic (calculations, CASE, filters, joins)
- When the user wants basic test coverage as a starting point
- When refactoring CDS logic and wanting regression tests
- NOT for trivial projections that just rename fields — if analysis in Step 2 finds no testable semantics (just field renames with no calculations, CASE, WHERE, JOINs, or aggregations), warn the user: *"This CDS view is a simple projection with no testable logic. Unit tests would only verify that fields are correctly aliased, which provides minimal value. Consider testing the underlying view instead."*
