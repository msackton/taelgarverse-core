// Small host-API fixture: exercise extension state and widget lifecycles without
// bundling a second CodeMirror instance into the Obsidian plugin.
export function codeMirrorHost() {
  return {
    state:{StateEffect:{define(){const effect={of:value=>({value,is:other=>other===effect})};return effect;}},StateField:{define:config=>config}},
    view:{WidgetType:class{},EditorView:{decorations:{from:field=>field}},ViewPlugin:{fromClass:value=>value},
      Decoration:{none:{ranges:[]},set:ranges=>({ranges}),replace:spec=>({range:(from,to)=>({from,to,value:spec})}),widget:spec=>({range:position=>({from:position,to:position,value:spec})})}},
  };
}
