"""Re-extract MITRE ATT&CK data with proper Unicode encoding."""
import urllib.request
import json
import os

print('Downloading MITRE ATT&CK STIX bundle...')
url = 'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json'
with urllib.request.urlopen(url) as r:
    raw_bytes = r.read()

stix = json.loads(raw_bytes.decode('utf-8'))
objects = stix['objects']
print(f'Loaded {len(objects)} objects')

def get_mitre_id(obj):
    for ref in obj.get('external_references', []):
        if ref.get('source_name') == 'mitre-attack':
            return ref.get('external_id')
    return None

def get_url(obj):
    for ref in obj.get('external_references', []):
        if ref.get('source_name') == 'mitre-attack':
            return ref.get('url', '')
    return ''

def get_platforms(obj):
    return obj.get('x_mitre_platforms', [])

def get_tactics(obj):
    return [kc['phase_name'].replace('-', ' ').title()
            for kc in obj.get('kill_chain_phases', [])]

# --- Extract techniques ---
techniques = []
for obj in objects:
    if obj.get('type') != 'attack-pattern':
        continue
    if obj.get('x_mitre_deprecated', False) or obj.get('revoked', False):
        continue
    mid = get_mitre_id(obj)
    if not mid:
        continue
    is_sub = '.' in mid
    parent_id = mid.rsplit('.', 1)[0] if is_sub else None
    techniques.append({
        'id': mid,
        'name': obj.get('name', ''),
        'description': obj.get('description', ''),
        'url': get_url(obj),
        'tactics': get_tactics(obj),
        'platforms': get_platforms(obj),
        'isSubTechnique': is_sub,
        'parentId': parent_id,
    })

techniques.sort(key=lambda t: t['id'])
print(f'Extracted {len(techniques)} techniques')

# --- Extract mitigations (course-of-action) ---
mitigations = []
for obj in objects:
    if obj.get('type') != 'course-of-action':
        continue
    if obj.get('x_mitre_deprecated', False) or obj.get('revoked', False):
        continue
    mid = get_mitre_id(obj)
    if not mid or not mid.startswith('M'):
        continue
    mitigations.append({
        'id': mid,
        'name': obj.get('name', ''),
        'description': obj.get('description', ''),
        'url': get_url(obj),
    })

mitigations.sort(key=lambda m: m['id'])
print(f'Extracted {len(mitigations)} mitigations')

# --- Extract technique-mitigation relationships ---
# Build STIX ID -> mitigation MITRE ID map
stix_id_to_mit = {}
for m in mitigations:
    for obj in objects:
        if obj.get('type') == 'course-of-action' and get_mitre_id(obj) == m['id']:
            stix_id_to_mit[obj['id']] = {'id': m['id'], 'name': m['name']}
            break

# Build STIX ID -> technique MITRE ID map
stix_id_to_tech = {}
for t in techniques:
    for obj in objects:
        if obj.get('type') == 'attack-pattern' and get_mitre_id(obj) == t['id']:
            stix_id_to_tech[obj['id']] = t['id']
            break

# More efficient: build maps directly
coa_stix_to_mitre = {}
for obj in objects:
    if obj.get('type') == 'course-of-action':
        mid = get_mitre_id(obj)
        if mid and mid.startswith('M'):
            mit_name = obj.get('name', '')
            coa_stix_to_mitre[obj['id']] = {'id': mid, 'name': mit_name}

ap_stix_to_mitre = {}
for obj in objects:
    if obj.get('type') == 'attack-pattern':
        mid = get_mitre_id(obj)
        if mid:
            ap_stix_to_mitre[obj['id']] = mid

tech_mitigations = {}
rel_count = 0
for obj in objects:
    if obj.get('type') != 'relationship':
        continue
    if obj.get('relationship_type') != 'mitigates':
        continue
    src = obj.get('source_ref', '')  # course-of-action
    tgt = obj.get('target_ref', '')  # attack-pattern
    if src in coa_stix_to_mitre and tgt in ap_stix_to_mitre:
        tech_id = ap_stix_to_mitre[tgt]
        mit_info = coa_stix_to_mitre[src]
        if tech_id not in tech_mitigations:
            tech_mitigations[tech_id] = []
        tech_mitigations[tech_id].append(mit_info)
        rel_count += 1

print(f'Extracted {rel_count} mitigation relationships for {len(tech_mitigations)} techniques')

# --- Verify encoding quality ---
all_desc = ' '.join(t['description'] for t in techniques)
fffd = all_desc.count('\ufffd')
apos = all_desc.count('\u2019')
dash = all_desc.count('\u2014')
print(f'U+FFFD in output: {fffd}')
print(f'Curly apostrophes: {apos}')
print(f'Em dashes: {dash}')

# --- Write files ---
data_dir = 'data'
os.makedirs(data_dir, exist_ok=True)

# Techniques
with open(os.path.join(data_dir, 'techniques.json'), 'w', encoding='utf-8') as f:
    json.dump(techniques, f, ensure_ascii=False, indent=2)

with open(os.path.join(data_dir, 'techniques.js'), 'w', encoding='utf-8') as f:
    f.write('window.MITRE_TECHNIQUES = ')
    json.dump(techniques, f, ensure_ascii=False)
    f.write(';\n')

# Mitigations
with open(os.path.join(data_dir, 'mitigations.json'), 'w', encoding='utf-8') as f:
    json.dump(mitigations, f, ensure_ascii=False, indent=2)

with open(os.path.join(data_dir, 'mitigations.js'), 'w', encoding='utf-8') as f:
    f.write('window.MITRE_MITIGATIONS = ')
    json.dump(mitigations, f, ensure_ascii=False)
    f.write(';\n')

# Technique mitigations mapping
with open(os.path.join(data_dir, 'technique_mitigations.json'), 'w', encoding='utf-8') as f:
    json.dump(tech_mitigations, f, ensure_ascii=False, indent=2)

with open(os.path.join(data_dir, 'technique_mitigations.js'), 'w', encoding='utf-8') as f:
    f.write('window.MITRE_TECHNIQUE_MITIGATIONS = ')
    json.dump(tech_mitigations, f, ensure_ascii=False)
    f.write(';\n')

print('\nAll files written successfully!')
print(f'techniques.js: {len(techniques)} entries')
print(f'mitigations.js: {len(mitigations)} entries')
print(f'technique_mitigations.js: {len(tech_mitigations)} entries')
