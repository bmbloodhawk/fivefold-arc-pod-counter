// Small DOM fixture for exercising the real cosmetic bridge without a browser.
// Browser QA separately verifies layout, focus, hit targets and visual output.
class Element {
  constructor(tag, properties) { this.tagName = tag; this.childNodes = []; this.dataset = {}; this.attributes = new Map(); this.parentNode = null; this.textContent = ''; this.properties = properties || new Map(); this.style = { getPropertyValue:key => this.properties.get(key) || '', setProperty:(key,value) => this.properties.set(key,value), removeProperty:key => this.properties.delete(key) }; this.className = ''; this.classList = { add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; }, remove:name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); }, contains:name => this.className.split(' ').includes(name), toggle:(name,active) => { if (active) this.classList.add(name); else this.classList.remove(name); } }; }
  setAttribute(name,value) { this.attributes.set(name,String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter) => letter.toUpperCase())]; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.childNodes.push(node); } }
  replaceChildren(...nodes) { for (const child of this.childNodes) child.parentNode = null; this.childNodes = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this); this.parentNode = null; }
  cloneNode(deep) { const result = new Element(this.tagName); result.textContent = this.textContent; result.raw = this.raw; result.attributes = new Map(this.attributes); result.className = this.className; result.dataset = { ...this.dataset }; if (deep) result.append(...this.childNodes.map(node => node.cloneNode(true))); return result; }
  querySelector(selector) { return descendants(this).find(node => selector === 'small' ? node.tagName === 'small' : false) || null; }
  get innerHTML() { return this.childNodes.map(node => node.raw || `<${node.tagName}>${node.textContent}${node.innerHTML}</${node.tagName}>`).join(''); }
}
const descendants = node => node.childNodes.flatMap(child => [child,...descendants(child)]);

export function rendererDocument(index = '') {
  const properties = new Map(), root = new Element('html',properties), head = new Element('head'), body = new Element('body'), game = new Element('section'), seal = new Element('div');
  seal.className = 'counter-sigil'; const baseSeal = new Element('svg'); baseSeal.raw = '<svg>base seal</svg>'; seal.append(baseSeal); game.append(seal);
  const buttons = new Map();
  const matches = [...index.matchAll(/<button\b[^>]*data-mode="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  for (const [,mode,markup] of matches) { const button = new Element('button'); button.dataset.mode = mode; button.setAttribute('aria-label',mode === 'commander' ? 'Commander damage' : mode[0].toUpperCase()+mode.slice(1)); const icon = new Element('svg'); icon.raw = markup.split('<small')[0]; const label = new Element('small'); label.textContent = markup.match(/<small[^>]*>(.*?)<\/small>/)?.[1] || mode; button.append(icon,label); game.append(button); buttons.set(mode,button); }
  body.append(game); root.append(head,body);
  const document = { documentElement:root,head,body,createElement:tag => new Element(tag),querySelector:selector => selector === '#gameView' ? game : selector === '.counter-sigil' ? seal : selector === '.counter-stage' || selector === '.dial-gesture' ? null : selector === 'link[data-renderer-theme]' ? descendants(head).find(node => node.dataset.rendererTheme !== undefined) : buttons.get(selector.match(/data-mode="([^"]+)"/)?.[1]) || null,querySelectorAll:selector => selector === '.skin-overlay' ? descendants(root).filter(node => node.classList.contains('skin-overlay')) : selector === '.pod-seat' ? descendants(game).filter(node => node.classList.contains('pod-seat')) : [] };
  return { document,properties,buttons,seal,game,root };
}
