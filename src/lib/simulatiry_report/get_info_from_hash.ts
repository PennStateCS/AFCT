import { prisma } from "../prisma";
import type { CodeAndUsers } from "./types";

export async function get_info_from_hash(hash: string | undefined, user_id: string): Promise<CodeAndUsers> {
    const codeAndUsers: CodeAndUsers = {
        code: null,
        ids: {
            user_ids: [],
            submission_ids: [],
        }
    };

    // No hash provided
    if (hash === undefined) {
        return codeAndUsers;
    }

    // Make API request to get the list of users and submission IDs that submitted the file with the same hash
    const response = await prisma.submission.findMany({
        where: { OR: [
            { fileHashData: hash },
            { calcHashData: hash },
        ] },
        select: {
            studentId: true,
            id: true,
        }
    });

    codeAndUsers.ids.user_ids = Array.from(new Set(response.map(r => r.studentId)));
    codeAndUsers.ids.submission_ids = Array.from(new Set(response.map(r => r.id)));

    if (codeAndUsers.ids.user_ids.length === 0) {
        codeAndUsers.code = 0; // No user submitted file
    } else if (codeAndUsers.ids.user_ids.includes(user_id) && codeAndUsers.ids.user_ids.length === 1) {
        codeAndUsers.code = 1; // Only user submitted file
    } else {
        codeAndUsers.code = 2; // At least one other user submitted file
    }

    return codeAndUsers;
}