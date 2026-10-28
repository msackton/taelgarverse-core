class EventManager {

    getPartyMeeting(file, campaign) {

        const { TokenParser } = customJS
        const { NameManager } = customJS
        const { DateManager } = customJS
        const { WhereaboutsManager } = customJS

        let results = []

        let metadata = file?.frontmatter ?? {}
        let displayData = NameManager.getDisplayData(metadata)
        let pageType = NameManager.getPageType(metadata)

        let format = displayData?.wParty

        function normalizeCampaignInfo(value) {
            if (!value) return []
            if (Array.isArray(value)) return value
            if (typeof value === "object") return [value]
            return []
        }

        for (let element of normalizeCampaignInfo(metadata.campaignInfo).filter(e => e.campaign && e.date)) {

                let displayDate = DateManager.normalizeDate(element.date)
                if (!displayDate) continue

                let locForThisDate = WhereaboutsManager.getWhereabouts(metadata, element.date).current;

                let formatStr = element.wParty ?? element.format ?? format

                if (locForThisDate && (element.campaign == campaign || !campaign)) {
                    let partyPage = NameManager.getCampaignPartyPage(element.campaign)
                    let person = element.person ?? partyPage ?? element.campaign
                    if (person) {
                        let type = element.type ?? "seen"
                        let personName = NameManager.getNameObject(person, pageType)   
                        let text = TokenParser.formatDisplayString(formatStr, {frontmatter: metadata, file: ""}, displayDate, {met: type, person: personName, sourcePageType: pageType})
                        results.push({ text: text, campaign: element.campaign, date: displayDate, location: locForThisDate.location })
                    }
                }
        }

        return results
    }

}
