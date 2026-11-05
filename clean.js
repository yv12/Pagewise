import sanitizeHtml from 'sanitize-html';

const options = {
  allowedTags: [
    'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'u',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'br', 'blockquote', 'hr'
  ],
  allowedAttributes: {
    a: ['href'],
    '*': ['style']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/]
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

