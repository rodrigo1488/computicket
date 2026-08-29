import os

path = r'c:\Users\user\Documents\projeto tickets\projeto tickets\templates\ps\index.html'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = 0
for i, line in enumerate(lines):
    if skip > 0:
        skip -= 1
        continue
    
    # Line 734 (0-indexed 733)
    if 'const isAdmin = {{ \'true\' if current_user.is_authenticated and current_user.has_role(\'admin\') else \'false\'' in line and i < 750:
        # Check next lines
        if i + 2 < len(lines) and '}' in lines[i+1] and '};' in lines[i+2]:
            new_lines.append(line.rstrip() + ' }};\n')
            skip = 2
            continue
    
    # Line 805 (0-indexed 804)
    if 'const isAdmin = {{ \'true\' if current_user.is_authenticated and current_user.has_role(\'admin\') else \'false\'' in line and i > 750:
         if i + 1 < len(lines) and '}};' in lines[i+1]:
            new_lines.append(line.rstrip() + ' }};\n')
            skip = 1
            continue

    new_lines.append(line)

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("File updated successfully")
