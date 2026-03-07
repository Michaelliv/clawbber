export default function (mercury: {
  cli(opts: { name: string; install: string }): void;
  permission(opts: { defaultRoles: string[] }): void;
  skill(relativePath: string): void;
}) {
  mercury.cli({
    name: "gws",
    install: "npm install -g @googleworkspace/cli",
  });

  // Admin-only by default.
  mercury.permission({ defaultRoles: ["admin"] });
  mercury.skill("./skill");
}
