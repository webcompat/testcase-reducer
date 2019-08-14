# testcase-reducer
An addon helping to reduce test-cases from live pages.

1. Inspect the element you would like to reduce a test-case for/from in the devtools.
2. Configure the parameters in the testcase reducer devtools panel for the addon;
   - Including ancestor nodes may be necessary to capture the HTML/CSS causing the issue.
   - Including CSS fonts may be necessary if webfonts are part of the problem.
   - Including @media rules can catch responsive breakpoints that may cause the issue.
   - Including important meta-tags can help for mobile layout (meta viewport) or charset/Content-Type issues.
   - Including @page rules can catch print-stylesheet-specific issues.
   - Including scripts may be helpful if the issue is script-triggered.
3. Click "reduce" to see the resulting markup and a preview.
   - Showing the preview iframe with the original viewport size can help reveal responsive breakpoint issues.
4. Copy and paste the markup to your own local file, or click to upload to Codepen, JSBin, or JSFiddle.

# Credits
This addon makes use of the following third-party libraries:

- JS Beautify by Einar Lielmanis, Liam Newman et al (https://github.com/beautify-web/js-beautify)
- Node CSS Selector Parser by Dulin Marat (https://github.com/mdevils/node-css-selector-parser)
