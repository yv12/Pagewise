import sanitizeHtml from 'sanitize-html';

const options = {
  allowedTags: [
    'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'u',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'br', 'blockquote', 'hr',
    'div', 'span'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    table: ['class', 'border', 'cellpadding', 'cellspacing', 'style'],
    tr: ['class', 'style'],
    td: ['class', 'style', 'colspan', 'rowspan'],
    th: ['class', 'style', 'colspan', 'rowspan'],
    div: ['class', 'style'],
    span: ['class', 'style'],
    p: ['class', 'style'],
    h1: ['class', 'style'],
    h2: ['class', 'style'],
    h3: ['class', 'style'],
    hr: ['class', 'style'],
    '*': ['style', 'class']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(bold|normal|[1-9]00)$/],
      'font-style': [/^(italic|normal)$/],
      'font-size': [/^[0-9.]+(pt|px|em|rem|%)?$/],
      'color': [/^#[0-9a-fA-F]{3,8}$|^rgba?\([^)]+\)$|^[a-zA-Z]+$/],
      'font-family': [/^.+$/],
      'line-height': [/^[0-9.]+(pt|px|em|rem|%)?$/],
      'display': [/^(flex|inline|inline-block|block|table|table-row|table-cell)$/],
      'justify-content': [/^(space-between|space-around|flex-start|flex-end|center)$/],
      'align-items': [/^(center|flex-start|flex-end|baseline|stretch)$/],
      'width': [/^[0-9.]+(%|px|em|rem|pt)?$/],
      'margin': [/^[0-9.\s]+(px|em|rem|pt|%)*$/],
      'margin-top': [/^[0-9.\s]+(px|em|rem|pt|%)*$/],
      'margin-bottom': [/^[0-9.\s]+(px|em|rem|pt|%)*$/],
      'padding': [/^[0-9.\s]+(px|em|rem|pt|%)*$/],
      'border': [/^(none|0)$/],
      'border-bottom': [/^.+$/]
    }
  }
};

/** If the content has no HTML tags, wrap paragraphs in <p>. */
function wrapPlainText(text) {
  if (/<[a-z][a-z0-9]*[\s>\/]/i.test(text)) return text;
  return text
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean)
    .map(b => `<p>${b}</p>`)
    .join('\n');
}

export function clean(html) {
  return sanitizeHtml(wrapPlainText(html), options);
}

