// Shared metadata classification; no host or date state.
export function getPageType(metadata) {

        if (!metadata) return "unknown"

        // Normalize tags to an array of strings; Dataview page objects or YAML can vary
        let rawTags = metadata.tags;
        let tags = [];
        if (Array.isArray(rawTags)) tags = rawTags;
        else if (typeof rawTags === 'string' || rawTags instanceof String) tags = [rawTags];
        // Some contexts only expose tags on the file object or as etags
        else if (metadata.file?.tags && Array.isArray(metadata.file.tags)) tags = metadata.file.tags;
        else if (metadata.file?.etags && Array.isArray(metadata.file.etags)) tags = metadata.file.etags.map(t => t.replace(/^#/, ''));

        // define fixed types
        const typePrefixes = [
            "person",
            "place",
            "object",
            "event",
            "group",
            "power",
            "ancestry",
            "creature"
        ];

        for (const tag of tags) {
            if (typeof tag !== "string") continue;
            for (const type of typePrefixes) {
                if (tag.startsWith(type)) {
                    return type;
                }
            }
        }
        return "unknown"
    }
