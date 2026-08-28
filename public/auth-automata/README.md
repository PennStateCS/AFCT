# Login page decoration

Every `.svg` file in this folder is drawn on the sign-in page's brand panel, one at a
time, crossfading to the next every couple of minutes. Add a file to add it to the
rotation, delete one to remove it. Files are read in filename order.

Two rules for a file to be used:

- It needs a `viewBox`. The panel is a fixed 444 x 234 box so the crossfade never shifts
  the layout, and each drawing is fitted into it. A file without a `viewBox` is skipped.
- Draw with `currentColor` to inherit the panel's blue tint, or give the shapes their own
  fills to keep the colours you drew. Either way it renders at the panel's low opacity,
  because this is background decoration and has to stay behind the sign-in form.

The files here are baked into the application image, so adding one takes a redeploy.
