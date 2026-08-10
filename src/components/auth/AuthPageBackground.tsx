/**
 * The branded backdrop the signed-out pages share: sign in, forgot password, choose a new
 * password.
 *
 * Two fixed layers rather than one, which is what gives it depth: a teal-to-navy diagonal
 * gradient, and a soft radial highlight over the middle. Both sit at `z-0`, so whatever
 * renders them must place its own content above.
 *
 * Extracted when the reset pages needed the same treatment. It was already written twice by
 * then, and a third copy is how two of them quietly stop matching.
 */
export function AuthPageBackground() {
  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-0 bg-gradient-to-br from-[#5F9EA0] via-[#6FAFB2] to-[#2F4A8A]"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15),transparent_70%)]"
      />
    </>
  );
}

export default AuthPageBackground;
