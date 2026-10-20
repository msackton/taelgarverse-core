import path from 'node:path';
import {createHash} from 'node:crypto';
import {RenderError, escapeHtml, pageUrl, titleCase} from './common.mjs';
import {availableInContext} from './content-store.mjs';
import {contextQuery} from './header.mjs';

const under = (file, directory) => directory === '.' || file.startsWith(directory + '/');
const directory = value => path.posix.normalize(value.trim().replace(/\\/g,'/').replace(/\/$/,''));
const alphabetical = (a,b) => a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'});

export class Navigation {
  constructor(store, template = null) {
    this.entries = store.entries.filter(entry=>entry.note);
    this.byTarget = new Map(this.entries.map(entry=>[entry.target,entry]));
    const roots = [], stack = [{indent:-1,children:roots}];
    for (const line of (template || '').split(/\r?\n/)) {
      const match = /^( *)-\s+(.+?)\s*$/.exec(line);
      if (!match) continue;
      const indent = match[1].length, content = match[2];
      while (stack.at(-1).indent >= indent) stack.pop();
      if (content.startsWith('{glob:')) {
        const glob = /^\{glob:\s*([^,}]+)(?:,\s*exclude:\s*([^}]*))?\}$/.exec(content);
        if (!glob) throw new Error('Invalid navigation expansion: ' + content);
        const parts = glob[1].split(';').map(part=>part.trim()).filter(Boolean);
        const dirs = parts.filter(part=>part!=='flatten').map(directory);
        const exclusions = new Set((glob[2] || '').split(';').map(part=>part.trim()));
        const entries = this.entries.filter(entry=>!exclusions.has(path.posix.basename(entry.target)));
        stack.at(-1).children.push(...this.expand(dirs,entries,parts.includes('flatten')));
      } else {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(content);
        const target = link ? decodeURIComponent(link[2]) : null;
        const node = {label:link ? link[1] : content,entry:this.byTarget.get(target),home:target==='index.md',children:[]};
        stack.at(-1).children.push(node);
        stack.push({indent,children:node.children});
      }
    }
    if (template === null) roots.push({label:'Home',home:true,children:[]},...this.expand(['.'],this.entries));
    this.nodes = new Map();
    this.paths = new Map();
    const index = (nodes,ancestors = []) => {
      const duplicates = new Map();
      return nodes.map(node=>{
        const key = node.home ? 'home' : node.entry?.target || node.label;
        const occurrence = duplicates.get(key) || 0;
        duplicates.set(key,occurrence + 1);
        const identity = (ancestors.at(-1)?.id || 'root') + '/' + key + '/' + occurrence;
        node.id = 'n' + createHash('sha256').update(identity).digest('hex').slice(0,16);
        this.nodes.set(node.id,node);
        const trail = [...ancestors,node];
        if (node.entry && !this.paths.has(node.entry.slug)) this.paths.set(node.entry.slug,trail);
        node.children = index(node.children,trail);
        return node;
      });
    };
    this.roots = index(roots);
  }

  expand(dirs, entries, flatten = false) {
    const nodes = [], seen = new Set();
    const add = entry => {
      if (!seen.has(entry)) { seen.add(entry); nodes.push({label:entry.title,entry,children:[]}); }
    };
    if (flatten) {
      for (const entry of entries) if (dirs.some(dir=>under(entry.target,dir))) add(entry);
      return nodes.sort(alphabetical);
    }
    const subdirs = new Set();
    for (const dir of dirs) for (const entry of entries) {
      const parent = path.posix.dirname(entry.target);
      if (parent === dir) add(entry);
      else if (under(entry.target,dir)) {
        const relative = dir==='.' ? entry.target : entry.target.slice(dir.length + 1);
        subdirs.add((dir==='.' ? '' : dir + '/') + relative.split('/')[0]);
      }
    }
    nodes.sort(alphabetical);
    for (const dir of [...subdirs].sort()) {
      const index = entries.find(entry=>entry.target===dir + '/' + path.posix.basename(dir) + '.md');
      const children = this.expand([dir],entries.filter(entry=>entry!==index));
      if (index || children.length) nodes.push({label:index?.title || titleCase(path.posix.basename(dir).replace(/-/g,' ')),entry:index,children});
    }
    return nodes;
  }

  view(context, page, branch) {
    const visible = new Map(), available = new Map();
    const visit = node => {
      const children = node.children.filter(child=>visit(child));
      let link = node.home;
      if (node.entry) {
        if (!available.has(node.entry)) available.set(node.entry,availableInContext(node.entry,context));
        link = available.get(node.entry);
      }
      if (!link && !children.length) return false;
      visible.set(node.id,{...node,entry:link ? node.entry : undefined,children});
      return true;
    };
    const roots = this.roots.filter(visit);
    let trail = this.paths.get(page) || [];
    if (branch) {
      if (!visible.has(branch)) throw new RenderError(404,'Navigation section not found');
      const find = (nodes,ancestors=[]) => {
        for (const node of nodes) {
          const path = [...ancestors,node];
          if (node.id === branch) return path;
          const child = find(node.children,path);
          if (child) return child;
        }
      };
      trail = find(this.roots) || [];
    }
    trail = trail.filter(node=>visible.has(node.id)).map(node=>visible.get(node.id));
    const selected = page ? this.paths.get(page)?.at(-1)?.id : trail.at(-1)?.id;
    return {context,page,roots,visible,trail,selected,active:new Set(trail.map(node=>node.id))};
  }

  url(node,context) {
    return node.home ? '/?' + contextQuery(context) : node.entry ? pageUrl(node.entry.slug,context.date,context) : this.browseUrl(node,context);
  }
  browseUrl(node,context) { return '/browse/' + node.id + '?' + contextQuery(context); }

  list(nodes,view) {
    return nodes.map(original=>{
      const node = view.visible.get(original.id);
      if (!node) return '';
      const active = node.id===view.selected || node.home && !view.page && !view.trail.length;
      const link = '<a href="' + escapeHtml(this.url(node,view.context)) + '"' + (active ? ' aria-current="page"' : '') + '>' + escapeHtml(node.label) + '</a>';
      if (!node.children.length) return '<li>' + link + '</li>';
      const open = view.active.has(node.id);
      const query = contextQuery(view.context);
      query.set('branch',node.id);
      if (view.page) query.set('page',view.page);
      const content = open ? this.list(node.children,view) : '<li class="nav-placeholder"><a href="' + escapeHtml(this.browseUrl(node,view.context)) + '">Browse section</a></li>';
      return '<li><details' + (open ? ' open' : '') + ' data-nav-url="' + escapeHtml('/api/navigation?' + query) + '">' +
        '<summary>' + link + '</summary><ul data-nav-children data-loaded="' + open + '">' + content + '</ul></details></li>';
    }).join('');
  }

  sidebar(view) {
    const fields = [...contextQuery(view.context)].map(([key,value])=>'<input type="hidden" name="' + key + '" value="' + escapeHtml(value) + '">').join('');
    return '<aside class="site-sidebar"><details class="site-navigation" open><summary>Explore Taelgar</summary>' +
      '<nav aria-label="Site navigation"><form class="nav-search" action="/">' + fields +
      '<label class="sr-only" for="nav-search">Search Taelgar</label><input id="nav-search" type="search" name="q" maxlength="256" placeholder="Search notes…"><button>Search</button></form>' +
      '<ul class="nav-tree">' + this.list(view.roots,view) + '</ul></nav></details></aside>';
  }

  breadcrumbs(view) {
    if (!view.trail.length) return '';
    const home = '<li><a href="' + escapeHtml('/?' + contextQuery(view.context)) + '">Home</a></li>';
    return '<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>' + home + view.trail.map((node,index)=>'<li>' +
      (index===view.trail.length-1 ? '<span aria-current="page">' + escapeHtml(node.label) + '</span>' :
        '<a href="' + escapeHtml(this.url(node,view.context)) + '">' + escapeHtml(node.label) + '</a>') + '</li>').join('') + '</ol></nav>';
  }

  branch(context,branch,page) {
    const view = this.view(context,page,branch), node = view.visible.get(branch);
    return {title:node.label,html:this.list(node.children,view)};
  }
}
