export function parseAccountText(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('请上传文件或粘贴学号、姓名。');
  const text = source.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === '') quoted = !quoted;
      else field += char;
    } else if (!quoted && char === delimiter) { row.push(field.trim()); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('文件引号未闭合，请检查 CSV 格式。');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  let studentIndex = 0, nameIndex = 1;
  if (rows[0]?.some((cell) => /^(学号|student_?id)$/i.test(cell))) {
    const header = rows.shift();
    studentIndex = header.findIndex((cell) => /^(学号|student_?id)$/i.test(cell));
    nameIndex = header.findIndex((cell) => /^(姓名|人名|name)$/i.test(cell));
    if (nameIndex < 0) throw new Error('表头需要包含“学号”和“姓名”。');
  }
  if (!rows.length) throw new Error('没有可导入的账号。');
  if (rows.length > 500) throw new Error('每次最多导入 500 个账号。');
  return rows.map((cells, index) => ({ line: index + 1, studentId: cells[studentIndex] || '', name: cells[nameIndex] || '' }));
}
