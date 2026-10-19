# Bundled preview assets

- material.css: Material for MkDocs 9.7.7, Copyright Martin Donath. MIT;
  see material-LICENSE. Source: https://github.com/squidfunk/mkdocs-material.
- ../icons/octicons-*.svg: GitHub Octicons, MIT; see octicons-LICENSE.
  Source: https://github.com/primer/octicons. Copied from the Material distribution.
- ../icons/material-calendar.svg: Pictogrammers Material Design Icons,
  Apache 2.0; see material-design-icons-LICENSE and Apache-2.0-LICENSE.
  Source: https://github.com/Templarian/MaterialDesign.
- ../icons/simple-dungeonsanddragons.svg: Simple Icons, CC0;
  see simple-icons-LICENSE. Source: https://github.com/simple-icons/simple-icons.
- ../taelgarverse.css: maintained Taelgarverse stylesheet, copied from
  taelgar-utils/website/overrides/assets/stylesheets/taelgarverse.css.

These are static assets. Updating them does not require Python at runtime.

The generated ../generated/diagrams.js browser bundle uses Mermaid 12.2.0,
Copyright Knut Sveidqvist, MIT; see mermaid-LICENSE. Source:
https://github.com/mermaid-js/mermaid. Dependency license comments are retained
in the bundle. Rebuild it with npm run build:browser after npm ci.
