class init {
    normalizeCampaignRegistry(payload) {
        const entries = payload?.campaigns
        if (!entries || Array.isArray(entries) || typeof entries !== "object") {
            throw new Error("Campaign registry must contain a campaigns object")
        }

        const normalized = []
        const codes = new Set()

        for (const [slug, raw] of Object.entries(entries)) {
            if (!raw || Array.isArray(raw) || typeof raw !== "object") {
                throw new Error(`Campaign ${slug} must be an object`)
            }

            const name = String(raw.name ?? "").trim()
            const code = String(raw.code ?? "").trim()
            const campaignRoot = String(raw.campaignRoot ?? "").trim().replace(/\/$/, "")
            const notePattern = String(raw.notePattern ?? "").trim()

            if (!name || !code) {
                throw new Error(`Campaign ${slug} must define name and code`)
            }
            if (codes.has(code.toLowerCase())) {
                throw new Error(`Campaign code ${code} is duplicated`)
            }
            codes.add(code.toLowerCase())

            const lastSlash = notePattern.lastIndexOf("/")
            const relativeSessionFolder = lastSlash >= 0 ? notePattern.slice(0, lastSlash) : ""
            const sessionNoteFolder = [campaignRoot, relativeSessionFolder]
                .filter(Boolean)
                .join("/")

            normalized.push({
                ...raw,
                slug,
                name,
                code,
                aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
                sessionNoteFolder
            })
        }

        return normalized
    }

    async invoke() {
        const metadataFilePath = app.vault.configDir + "/metadata.json";
        const campaignRegistryPath = "_scripts/session_note_campaigns.json";
        const [metadataFile, campaignRegistryFile] = await Promise.all([
            app.vault.adapter.read(metadataFilePath),
            app.vault.adapter.read(campaignRegistryPath)
        ])

        const coreMeta = JSON.parse(metadataFile)
        const campaignRegistry = this.normalizeCampaignRegistry(JSON.parse(campaignRegistryFile))

        // All runtime consumers receive campaign data derived from the canonical registry.
        // The legacy metadata.json list can remain temporarily for older external consumers.
        coreMeta.campaigns = campaignRegistry
        customJS.state.coreMeta = coreMeta
        customJS.state.campaignRegistry = campaignRegistry
    }
}
