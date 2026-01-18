import { generateText } from "ai";
import { inngest } from "./client";
import { anthropic } from "@ai-sdk/anthropic";
import { firecrawl } from "@/lib/firecrawl";

const URL_REGEX = /https?:\/\/[^\s]+/g;

export const demoGenerate = inngest.createFunction(
  { id: "demo-generate" },
  { event: "demo/generate" },
  async ({ event, step }) => {
    const { prompt } = event.data as { prompt: string; };

    const urls = await step.run("exctract-urls", async () => {
      return prompt.match(URL_REGEX) ?? [];
    }) as string[];

    const scrapedContent = await step.run("scrape-urls", async () => {
      const results = await Promise.all(
        urls.map(async (url) => {
          const result = await firecrawl.scrape(
            url,
            { formats: ["markdown"] },
          );
          return result.markdown ?? null;
        })
      );
      return results.filter(Boolean).join("\n\n");
    });

    const finalPrompt = scrapedContent
      ? `Context:\n${scrapedContent}\n\nQuestion: ${prompt}`
      : prompt;

    await step.run("generate-text", async () => {
      return await generateText({
        model: anthropic('claude-3-haiku-20240307'),
        prompt: finalPrompt,
        experimental_telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
        },
      });
    })
  },
);

export const demoError = inngest.createFunction(
  { id: "demo-error" },
  { event: "demo/error" },
  async ({ step }) => {
    await step.run("fail", async () => {
      throw new Error("Inngest error: Background job failed!");
    });
  }
);

import { Octokit } from "@octokit/rest";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export const importRepository = inngest.createFunction(
  { id: "import-repository" },
  { event: "github/import.repository" },
  async ({ event, step }) => {
    const { repoUrl, projectId } = event.data as { repoUrl: string, projectId: string };

    const repoFiles = await step.run("fetch-repo-files", async () => {
      const [owner, repo] = repoUrl.replace("https://github.com/", "").split("/");
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });
      const { data: treeData } = await octokit.git.getTree({
        owner,
        repo,
        tree_sha: refData.object.sha,
        recursive: "true",
      });
      return treeData.tree;
    });

    await step.run("create-files", async () => {
      const { convex } = await import("@/lib/convex-client");
      const { api } = await import("../../convex/_generated/api");
      const { Id } = await import("../../convex/_generated/dataModel");

      for (const file of repoFiles) {
        if (file.type === "blob" && file.path) {
          const { data: blobData } = await octokit.git.getBlob({
            owner: repoUrl.replace("https://github.com/", "").split("/")[0],
            repo: repoUrl.replace("https://github.com/", "").split("/")[1],
            file_sha: file.sha!,
          });

          await convex.mutation(api.files.createFile, {
            projectId: projectId as Id<"projects">,
            name: file.path,
            content: Buffer.from(blobData.content, "base64").toString("utf-8"),
          });
        }
      }
    });

    return { event, body: "Repository imported!" };
  },
);
