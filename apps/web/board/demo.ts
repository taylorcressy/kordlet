import { apiClient } from "../../../packages/client";
export async function loadDemo(call: ReturnType<typeof apiClient>) {
  const project = await call("project.create", {
    name: "Kordlet",
    prefix: "KOR",
  });
  const groups = [
    [
      "Add project templates",
      "Improve error handling and retry strategy",
      "Document agent setup and workflows",
    ],
    [
      "Design MCP tool schema for Kordlet",
      "Add CLI command help",
      "Implement issue search",
    ],
    [
      "Implement MCP server for agent tools",
      "Integrate progress into issue activity",
      "Link repository metadata",
    ],
    [
      "Review task planning and decomposition",
      "Review CLI output",
      "Review local runtime stability",
    ],
    [
      "Project scaffolding and local init",
      "Build the issue board",
      "Add service health check",
    ],
  ];
  const demoAgent = await call("credential.create", {
    projectId: project.id,
    kind: "agent",
  });
  const agent = apiClient("", demoAgent.token);
  let selected = "";
  try {
    for (const [lane, titles] of groups.entries())
      for (const [index, title] of titles.entries()) {
        const featured = lane === 2 && index === 0;
        let issue = await call("issue.create", {
          projectId: project.id,
          title,
          priority: index === 0 ? "High" : index === 2 ? "Low" : "Medium",
          labels:
            index === 0 ? ["MCP", "API"] : index === 1 ? ["CLI"] : ["Local"],
          assignee: lane > 0 ? ["Builder", "Devon", "Riley"][index] : null,
          ...(featured
            ? {
                description:
                  "Implement a Model Context Protocol adapter for Kordlet so coding tools can discover issues, claim ready work, and submit evidence for human review.",
                criteria: [
                  "MCP server starts in local mode",
                  "Expose issue and claim operations",
                  "Pass a basic SDK client test",
                  "Document usage and tool descriptions",
                ],
              }
            : {}),
        });
        if (featured) selected = issue.id;
        if (lane === 4) {
          await call("issue.complete", {
            issueId: issue.id,
            expectedRevision: issue.revision,
          });
          continue;
        }
        if (lane >= 1)
          issue = await call("issue.transition", {
            issueId: issue.id,
            expectedRevision: issue.revision,
            status: "Ready",
          });
        if (lane >= 2) {
          const claim = await agent("issue.claim", { issueId: issue.id });
          issue = await call("issue.get", { issueId: issue.id });
          if (lane === 3)
            await agent("review.submit", {
              issueId: issue.id,
              expectedRevision: issue.revision,
              generation: claim.generation,
              evidence: {
                summary:
                  "Implemented the scoped change and checked the documented workflow.",
                criteria: [],
                checks: ["Local smoke check · reported passing"],
                references: [],
                limitations: "",
              },
            });
        }
      }
  } finally {
    await call("credential.revoke", {
      projectId: project.id,
      credentialId: demoAgent.credential.id,
    });
  }
  return { project, selected };
}
