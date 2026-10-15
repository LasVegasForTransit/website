"""Parse all maintained Python files without producing bytecode or reading secrets."""
import ast
import pathlib

root = pathlib.Path(__file__).parents[1]
for directory in ('src', 'tests/support'):
    for path in (root / directory).glob('*.py'):
        ast.parse(path.read_text(), filename=str(path))
print('Backup Python source parsed successfully')
