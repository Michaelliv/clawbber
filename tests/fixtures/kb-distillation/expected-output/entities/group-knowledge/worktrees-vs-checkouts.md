# Worktrees vs Checkouts

Date: 2026-02-19
Participants: [[shahaf]], [[michael]]

## The Question
[[shahaf]] shared Twitter thread about not using worktrees, noted the author uses multiple clones with checkouts instead. Wondered why.

## The Conclusion
"לא אין המון הבדל, זה דיון של tabs vs spaces" - [[michael]]

Both approaches valid, minor differences only.

## Key Differences

**Checkouts (multiple clones):**
- Cleaner workflow when done: "בcheckout נפרד אתה פשוט ממשיך עם החיים שלך"
- Each clone contains full history
- [[shahaf]] uses ~10 clones, pulls main, branches for each feature

**Worktrees:**
- Requires manual cleanup via git CLI when done with branch
- Points to original .git, smaller size
- "worktree מצביע ל.git המקורי אז הוא קטן"

## Practical Note
Both [[shahaf]] and [[michael]] use separate directories for parallel work, regardless of worktree vs checkout approach.
