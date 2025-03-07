import * as core from '@actions/core';
import * as github from '@actions/github';
import { debug } from 'console';
import { addIssueComment } from './api-github';

import {
  getLabelsOfBoard,
  getMembersOfBoard,
  getCardsOfListOrBoard,
  createCard,
  updateCard,
  getCardAttachments,
  addAttachmentToCard,
} from './api-trello';
import { TrelloCard, TrelloCardRequestParams } from './types';
import { cardHasPrLinked, isIssueAlreadyLinkedTo, validateListExistsOnBoard } from './utils';

const verbose: string | boolean = process.env.TRELLO_ACTION_VERBOSE || false;
const action = core.getInput('action');
const updateType = core.getInput('updateType');


/**
 * GW webhook payload.
 *
 * @see https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#webhook-payload-example-48
 */
const ghPayload: any = github.context.payload;
const repository: any = github.context.repo;
if (!action) {
  throw Error('Action is not set.');
}

try {
  switch (action) {
    case 'issue_opened_create_card':
      issueOpenedCreateCard();
      break;
    case 'pull_request_event_move_card':
      pullRequestEventMoveCard();
      break;
    case 'test_case':
      get_list_of_card_names_in_board();
      break;
      
    default:
      throw Error('Action is not supported: ' + action);
  }

  if(!updateType)
  {
    throw Error("updateType is not set");
  }
  get_Patch_VersionNumber();

} catch (error) {
  core.setFailed(error as Error);
}
function get_Patch_VersionNumber()
{
  var currentVersion : string = core.getInput('currentVersion') as string;
  var versionNos : string[];
  versionNos = currentVersion.split(".",3);

  switch(updateType)
  {
    case 'fix':
      UpdateVersionsNos(2);
      currentVersion = versionNos[0] + '.' + versionNos[1] + '.' + versionNos[2];
      break;
    case 'feat':
      UpdateVersionsNos(1);
      currentVersion = versionNos[0] + '.' + versionNos[1] +  '.0';
      break;
    case 'change':
      UpdateVersionsNos(0);
      currentVersion = versionNos[0] + '.0.0';
      break;
    case 'none':
      break;
    default:
      throw Error('Update type not supported: '+ updateType);
  }

  function UpdateVersionsNos(index: number) {
    var nor = Number(versionNos[index]) + 1;
    versionNos[index] = nor.toString();
  }

  console.log(currentVersion);
  core.setOutput('currentVersion', currentVersion);
}
function get_list_of_card_names_in_board() {
  console.log("starting: test case");
  const sourceList: string = process.env.TRELLO_SOURCE_LIST_ID as string;
  const targetList: string = process.env.TRELLO_TARGET_LIST_ID as string;
  const additionalMemberIds: string[] = [];

  if (
    (sourceList && !validateListExistsOnBoard(sourceList)) ||
    !targetList ||
    !validateListExistsOnBoard(targetList)
  ) {
    core.setFailed('TRELLO_SOURCE_LIST_ID or TRELLO_TARGET_LIST_ID is invalid.');
    return;
  }
  // Fetch all cards in the board
  getCardsOfListOrBoard(targetList).
  then((cardsOnList) => {
    // Filter cards to those which refer to the Github Issues mentioned in the PR.
    if (typeof cardsOnList === 'string') {
      core.setFailed(cardsOnList);
      return [];
    }
    return cardsOnList.filter((card) =>
    {
      //console.log(card.name);
      return card.name != '';
    });
  })
  .then((allValidCards)=>
  {
    var patchNote = '\n_*PATCH NOTES:*_\n';
    var newcontent= new Array();
    var changescontent= new Array();
    var Bugcontent= new Array();
    allValidCards.forEach((card)=>
    {
        var attached = false;
        card.labels.forEach((label)=> 
        {
          if(label.name == "New Feature")
          {
            newcontent.push(card.name);
            attached = true;
          }
          if(label.name == "Bug")
          {
            Bugcontent.push(card.name);
            attached = true;
          }
         });
         if(attached == false)
         {
          changescontent.push(card.name);
         }
    });
    //console.log(newcontent);
    if(newcontent.length == 0 && changescontent.length == 0 && Bugcontent.length==0)
    {
      patchNote += "Quick bug fixes"
    }
    else
    {
    patchNote += newFunction(newcontent,'*New Features/Content*');
    patchNote += newFunction(changescontent,'*Changes/Updates*');
    patchNote += newFunction(Bugcontent,'*Bug Fixes*');
    }
    patchNote = patchNote.replace('\'',"");
    core.setOutput('patchNote', patchNote);
  })
}

function newFunction(newcontent: any[], categoryName: string) {
  var patchNote ='';
  if (newcontent.length > 0) {
    patchNote += '\n'+ categoryName+':';
    for (let i = 0; i < newcontent.length; i++) {
      patchNote += "\n\t•" + newcontent[i];
    }
  }
  patchNote += '\n';
  return patchNote;
}

function issueOpenedCreateCard() {
  const issue = ghPayload.issue;
  const issueNumber = issue?.number;
  const issueTitle = issue?.title;
  const issueBody = issue?.body;
  const issueUrl = issue?.html_url;
  const issueAssigneeNicks = issue?.assignees.map((assignee: any) => assignee.login);
  const issueLabelNames = issue?.labels.map((label: any) => label.name);
  const listId: string = process.env.TRELLO_LIST_ID as string;
  const trelloLabelIds: string[] = [];
  const memberIds: string[] = [];
  if (verbose) {
    console.log(JSON.stringify(repository, undefined, 2));
  }

  if (!validateListExistsOnBoard(listId)) {
    core.setFailed('TRELLO_LIST_ID is not valid.');
    return;
  }

  const getLabels = getLabelsOfBoard().then((trelloLabels) => {
    if (typeof trelloLabels === 'string') {
      core.setFailed(trelloLabels);
      return;
    }
    const intersection = trelloLabels.filter((label) => issueLabelNames.includes(label.name));
    const matchingLabelIds = intersection.map((trelloLabel) => trelloLabel.id);
    trelloLabelIds.push(...matchingLabelIds);
  });

  const getMembers = getMembersOfBoard().then((trelloMembers) => {
    if (typeof trelloMembers === 'string') {
      core.setFailed(trelloMembers);
      return;
    }
    const membersOnBothSides = trelloMembers.filter((member) =>
      issueAssigneeNicks.includes(member.username),
    );
    const matchingMemberIds = membersOnBothSides.map((trelloMember) => trelloMember.id);
    memberIds.push(...matchingMemberIds);
  });

  Promise.all([getLabels, getMembers]).then(() => {
    const params = {
      number: issueNumber,
      title: issueTitle,
      description: issueBody,
      sourceUrl: issueUrl,
      memberIds: memberIds.join(),
      labelIds: trelloLabelIds.join(),
    } as unknown as TrelloCardRequestParams;

    if (verbose) {
      console.log(`Creating new card to ${listId} from issue  "[#${issueNumber}] ${issueTitle}"`);
    }
    // No need to create the attachment for this repository separately since the createCard()
    // adds the backlink to the created issue, see
    // params.sourceUrl property.
    createCard(listId, params).then((createdCard) => {
      if (typeof createdCard === 'string') {
        core.setFailed(createdCard);
        return;
      }

      if (verbose) {
        console.log(
          `Card created: "[#${issueNumber}] ${issueTitle}], url ${createdCard.shortUrl}"`,
        );
      }

      const markdownLink: string = `Trello card: [${createdCard.name}](${createdCard.shortUrl})`;
      const commentData = {
        comment: markdownLink,
        issueNumber: issueNumber,
        repoOwner: repository.owner,
        repoName: repository.repo,
      };

      addIssueComment(commentData)
        .then((success) => {
          if (success) {
            if (verbose) {
              console.log(`Link to the Trello Card added to the issue: ${createdCard.shortUrl}`);
            }
          } else {
            console.error(`Non-fatal error: Failed to add link to the Trello card.`);
          }
        })
        .catch(() => {
          console.error(`Non-fatal error: Failed to add link to the Trello card.`);
        });
    });
  });
}

function pullRequestEventMoveCard() {
  const pullRequest = ghPayload.pull_request;
  const pullNumber = pullRequest.number;
  const repoHtmlUrl = github.context.payload.repository?.html_url || 'URL missing in GH payload';

  const sourceList: string = process.env.TRELLO_SOURCE_LIST_ID as string;
  const targetList: string = process.env.TRELLO_TARGET_LIST_ID as string;
  const additionalMemberIds: string[] = [];

  if (
    (sourceList && !validateListExistsOnBoard(sourceList)) ||
    !targetList ||
    !validateListExistsOnBoard(targetList)
  ) {
    core.setFailed('TRELLO_SOURCE_LIST_ID or TRELLO_TARGET_LIST_ID is invalid.');
    return;
  }

  // TODO: Allow unspecified target as well so that - say - PR moves card to "Ready for review"
  // list regardless of where it is currently.
  getCardsOfListOrBoard(sourceList)
    .then((cardsOnList) => {
      // Filter cards to those which refer to the Github Issues mentioned in the PR.
      if (typeof cardsOnList === 'string') {
        core.setFailed(cardsOnList);
        return [];
      }
      const referencedIssuesInGh: string[] = pullRequest?.body?.match(/#[1-9][0-9]*/) || [];

      return cardsOnList
        .filter((card) => {
          const haystack = `${card.name} ${card.desc}`;
          const issueRefsOnCurrentCard = haystack.match(/#[1-9][0-9]*/) || [];

          const crossMatchIssues = issueRefsOnCurrentCard.filter((issueRef) =>
            referencedIssuesInGh.includes(issueRef),
          );
          return crossMatchIssues.length !== 0;
        })
        .filter((card) => {
          // Filter cards to those which refer to the Github repository via any attachment.
          // Note that link in card.desc is not satisfactory.
          return getCardAttachments(card.id).then((attachments) => {
            if (typeof attachments === 'string') {
              return false;
            }

            attachments.find((attachment) => attachment.url.startsWith(repoHtmlUrl));
            return attachments.length !== 0;
          });
        });
    })
    // Final list of cards that need to be moved to target list.
    .then((cardsToBeMoved) => {
      const params = {
        destinationListId: targetList,
        memberIds: additionalMemberIds.join(),
      };
      cardsToBeMoved.forEach((card) => {
        if (verbose) {
          console.log(`Moving card "${card.name}" to board to ${targetList}.`);
        }
        updateCard(card.id, params)
          .then((trelloCard) => {
            if (typeof trelloCard === 'string') {
              core.setFailed(trelloCard);
              return;
            }

            if (verbose) {
              console.log(`Card "${card.name}" moved to board ${targetList}.`);
            }

            // Create the backlink to PR only if it is not there yet.
            !cardHasPrLinked(card, repoHtmlUrl) &&
              addAttachmentToCard(card.id, pullRequest?.html_url || '').then((attachment) => {
                if (typeof attachment === 'string') {
                  core.setFailed(attachment);
                  return;
                }
                if (verbose) {
                  console.log(
                    `Link (attachment) to pull request URL ${attachment.url} added to the card "${card.name}".`,
                  );
                }
              });
          })
          .then(() => {
            const markdownLink: string = `Trello card: [${card.name}](${card.shortUrl})`;
            const commentData = {
              comment: markdownLink,
              issueNumber: pullNumber,
              repoOwner: repository.owner,
              repoName: repository.repo,
            };

            // Spread and desctruction of an object property.
            const { comment, ...issueLocator } = commentData;

            if (!isIssueAlreadyLinkedTo(card.shortUrl, issueLocator)) {
              addIssueComment(commentData)
                .then((success) => {
                  if (success) {
                    verbose &&
                      console.log(`Link to the Trello Card added to the PR: ${card.shortUrl}`);
                  } else {
                    console.error(`Non-fatal error: Failed to add link to the Trello card.`);
                  }
                })
                .catch(() => {
                  console.error(`Non-fatal error: Failed to add link to the Trello card.`);
                });
            } else {
              if (verbose) {
                console.log(
                  `Link to the Trello Card was found in the comments, so adding it was skipped.`,
                );
              }
            }
          })
          .catch((error) => {
            console.error(error);
            core.setFailed(
              'Something went wrong when updating Cards to be moved to some new column.',
            );
            return [];
          });
      });
    });
}
