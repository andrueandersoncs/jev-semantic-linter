# Avoid magic values

Values that control behavior must have a descriptive name explaining their
meaning. Put configurable policy values in configuration and use named constants
for fixed domain values.

A literal is not a violation when its meaning is intrinsic to the syntax or
protocol where it appears, such as a command-line flag, regular expression,
user-facing message, discriminated-union label, or module specifier.

Values stored under descriptive keys in a dedicated configuration file are named
configuration, not magic values.