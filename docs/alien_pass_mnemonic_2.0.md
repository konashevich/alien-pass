# AlienPass v2.0 Master Specification

Reference architecture for the AlienPass stateless password generator.

## Part I. Concept and Philosophy

### 1. Zero-Storage Design

AlienPass does not use a password database and does not store per-site profiles. Every value required for password generation is supplied at generation time.

### 2. CLI-in-a-Field Input Model

The interface is reduced to two inputs:

- `Login`
- `InputString`

`Login` must include the numeric index suffix in this form: `BaseLogin,Index`, for example `test@me.com,1`.

`InputString` behaves like a compact command line. The user may enter a short modifier prefix that overrides defaults, then a colon, then the secret mnemonic model.

This design keeps the format precise without checkboxes, sliders, or per-site records.

## Part II. Grammar and Parsing

`InputString` must be parsed with this regular expression:

```regex
^(?:(abc|pin)?(\d{1,2})?\:)?(.*)$
```

### Parsed fields

1. `Alphabet`
   - Source: capture group 1
   - Default: `"default"`

2. `Length`
   - Source: capture group 2
   - Default: `14`
   - Valid range after parsing: `4` to `64`

3. `Secret`
   - Source: capture group 3
   - Required for generation
   - This is the user’s secret mnemonic model, for example `FacebookTower35`

If the colon is absent, the entire input is treated as `Secret`.

### Examples

- `abc11:WeirdSiteTower`
  - Length: `11`
  - Alphabet: letters and digits only

- `pin4:MyBankTower`
  - Length: `4`
  - Alphabet: digits only

- `GmailTower`
  - Length: `14`
  - Alphabet: default

- `AmazonTower`
  - Length: `14`
  - Alphabet: default
  - Entire string is the secret

## Part III. Cryptographic Core

AlienPass v2.0 derives entropy with PBKDF2.

### PBKDF2 parameters

- PRF: `HMAC-SHA256`
- Iterations: `600000`
- Password input: `Secret`, encoded as UTF-8 bytes
- Salt input: `Login`, encoded as UTF-8 bytes
- Separator: comma only, no alternate separator
- Output length: `64 bytes`

### Salt example

If the login field is:

- `Login = test@me.com,1`

Then the salt string is:

```text
test@me.com,1
```

The PBKDF2 output is a 64-byte array named `HashBytes`.

## Part IV. Alphabets

These character sets are fixed and indexed from `0`.

- `UPPER` (26): `ABCDEFGHIJKLMNOPQRSTUVWXYZ`
- `LOWER` (26): `abcdefghijklmnopqrstuvwxyz`
- `NUMS` (10): `0123456789`
- `SYMBOLS` (4): `!@_-`

### Combined alphabets

- `MIX_DEFAULT` (66): `UPPER + LOWER + NUMS + SYMBOLS`
- `MIX_ABC` (62): `UPPER + LOWER + NUMS`

## Part V. Deterministic Formatting

Create an empty string named `Password`.

Loop from `i = 0` to `i = Length - 1`. On each step, append one character to `Password`.

The character index is calculated as:

```text
HashBytes[i] % length_of_selected_alphabet
```

### Scenario A. `Alphabet == "default"`

- `i = 0`: select from `UPPER`
- `i = 1`: select from `LOWER`
- `i = 2`: select from `NUMS`
- `i = 3`: select from `SYMBOLS`
- `i >= 4`: select from `MIX_DEFAULT`

### Scenario B. `Alphabet == "abc"`

- `i = 0`: select from `UPPER`
- `i = 1`: select from `LOWER`
- `i = 2`: select from `NUMS`
- `i >= 3`: select from `MIX_ABC`

### Scenario C. `Alphabet == "pin"`

- For every `i`: select from `NUMS`

## Part VI. Result

The program returns the final `Password` string at the requested length.

The result is deterministic. Any compatible AlienPass implementation that uses the same `Login` and `InputString` must produce the same password.
